#!/usr/bin/env node
var nc=require('./node_modules/node-ncurses/ncurses'),
    fs=require('fs'),
    http=require('http'),
    VisualWidth=require('./visualwidth.js');

// TODO: node-locale.js for setlocale(LC_ALL, '')

var HoshiPad = {
    cursorX: 0,
    cursorY: 0,
    lineno: 0,
    col: 0,
    window: null,

    buffer: null,
    filename: null,
    commandHeader: '',
    commandBuffer: '',
    commandCursorX: 0,
    error: '',

    // constants
    MODE_INSERT: 1,
    MODE_ESCAPE: 2,
    MODE_COMMAND: 3,

    // color scheme
    COLOR_MODE_LINE: null,
    COLOR_ERROR_MESSAGE: null,
    COLOR_MESSAGE: null,

    abort: function (msg) {
        nc.cleanup();
        if (msg) {
            console.log(msg);
        }
        process.exit();
    },

    commands: { },

    init: function () {
        this.window = new nc.Window();
        nc.showCursor = true;

        this.buffer = new HoshiPad.Buffer();

        this.COLOR_MODE_LINE     = nc.colorPair(2);
        this.COLOR_ERROR_MESSAGE = nc.colorPair(3);
        this.COLOR_MESSAGE = nc.colorPair(4);

        this.mode = this.MODE_ESCAPE;
        this.window.on('inputChar', this.onInputChar.bind(this));

        // command alias
        this.q = this.quit;
        this.o = this.open;
        this.w = this.write;

        if (process.argv.length > 2) {
            this.open(process.argv[2]);
        }

        process.on('exit', function () {
            nc.cleanup();
            process.exit();
        });
        process.on('uncaughtException', function (err) {
            nc.cleanup();
            console.log('Caught exception: ' + err);
            process.exit();
        });
        process.on('SIGINT', function () {
            nc.cleanup();
            process.exit();
        });
    },
    showModeLine: function () {
        this.window.attron(this.COLOR_MODE_LINE);
        var modeline = this.mode == this.MODE_ESCAPE ? 'ESC'
                     : this.mode == this.MODE_INSERT ? 'INS'
                                                     : 'CMD';
        for (var i=3; i<this.window.width; i++) {
            modeline += '-';
        }
        this.window.addstr(this.window.height-2, 0, modeline);
        this.window.attroff(this.COLOR_MODE_LINE);
    },
    renderCommandLine: function () {
        this.window.addstr(this.window.height-1, 0, this.commandHeader);
        this.window.addstr(this.window.height-1, 1, this.commandBuffer);
    },
    onInputChar: function (c, i) {
        if (i == nc.keys.ESC) {
            this.mode = this.MODE_ESCAPE;
        } else {
            if (this.mode == this.MODE_ESCAPE) {
                if (c == 'i') {
                    this.mode = this.MODE_INSERT;
                } else if (c == 'h') {
                    if (this.cursorX > 0) {
                        this.cursorX -= 1;
                    } else {
                        this.beep();
                    }
                } else if (c == 'l') {
                    if (this.cursorX+1 < this.buffer.getText(this.lineno).length) {
                        this.cursorX += 1;
                    } else {
                        this.beep();
                    }
                } else if (c == 'k') {
                    if (this.cursorY > 0) {
                        this.cursorY -= 1;
                        this.lineno--;
                        var line_length = this.buffer.getText(this.lineno).length;
                        if (line_length == 0) {
                            this.cursorX = 0;
                        } else if (this.cursorX >= line_length) {
                            this.cursorX = line_length - 1;
                        }
                    } else {
                        this.beep();
                    }
                } else if (c == 'j') {
                    if (this.cursorY+1 < this.buffer.getLineCount()) {
                        this.cursorY += 1;
                        this.lineno++;
                        var line_length = this.buffer.getText(this.lineno).length;
                        if (line_length == 0) {
                            this.cursorX = 0;
                        } else if (this.cursorX >= line_length) {
                            this.cursorX = line_length - 1;
                        }
                    } else {
                        this.beep();
                    }
                } else if (c == ':') {
                    this.mode = this.MODE_COMMAND;
                    this.commandHeader = ':';
                    this.commandBuffer = '';
                    this.commandCursorX = 1;
                }
            } else if (this.mode == this.MODE_INSERT) { // in insert mode
                if (i == nc.keys.NEWLINE) {
                    this.lineno++;
                    this.cursorY++;
                    // TODO: auto indent
                    this.cursorX = 0;
                    this.buffer.insertText(this.lineno, "");
                } else {
                    this.window.addstr(c);
                    this.cursorX += VisualWidth.width(c);
                    this.buffer.replaceText(this.lineno, this.buffer.getText(this.lineno) + c);
                }
            } else if (this.mode == this.MODE_COMMAND) {
                if (i == nc.keys.NEWLINE) {
                    var command = this.commandBuffer;
                    this.commandBuffer = '';
                    if (command.length > 0) {
                        this.processCommand(command);
                    }
                } else if (i == nc.keys.BACKSPACE) {
                    var removedChar = this.commandBuffer.substr(this.commandBuffer.length-1, 1);
                    this.commandBuffer = this.commandBuffer.substr(0,this.commandBuffer.length-1);
                    this.commandCursorX -= VisualWidth.width(removedChar);
                } else {
                    this.window.addstr(c);
                    this.commandBuffer += c;
                    this.commandCursorX += VisualWidth.width(c);
                }
            } else {
                this.abort("Unknown mode : " + this.mode);
            }
        }
        this.redraw();
        return;
    },
    beep: function () {
        nc.beep();
    },
    log: function (msg) {
        fs.appendFileSync('debug.log', msg + "\n", 'utf-8');
    },
    quit: function () {
        this.log("bye");
        nc.cleanup();
        process.exit();
    },
    open: function (fname) {
        if (!fname) {
            this.error = "E32: No file name";
            return;
        }
        this.log('opening file: ' + fname);
        fs.readFile(fname, 'utf-8', (function (err, data) {
            if (err) {
                this.log(err);
                this.error = '' + err;
                this.redraw();
                return;
            }
            this.buffer.removeAll();
            var lines = data.split(/\n/);
            for (var i=0; i<lines.length; i++) {
                this.buffer.insertText(i, lines[i]);
            }
            this.cursorX = 0;
            this.cursorY = 0;
            this.lineno = 0;
            this.col    = 0;
            this.filename = fname;
            this.redraw();
        }).bind(this));
        this.mode = this.MODE_ESCAPE;
    },
    // save a buffer content to file
    write: function (fname) {
        if (!fname) { fname = this.filename; }
        if (!fname) {
            this.error = "E32: No file name";
            return;
        }
        this.message = 'writing data to ' + fname;
        fs.writeFile(fname, this.buffer.toString(), function (err) {
            if (err) {
                this.error = err;
            } else {
                this.message = 'wrote file to ' + fname;
            }
        });
        this.mode = this.MODE_ESCAPE;
    },
    processCommand: function (command) {
        if (this[command]) {
            return this[command].apply(this);
        }

        // command with args
        var r = command.match(/^(\S+)\s+(.+)$/);
        if (r) {
            if (this[r[1]]) {
                return this[r[1]].apply(this, [r[2]]);
            }
        }

        this.mode = this.MODE_ESCAPE;
        this.error = "E492: Not an editor command: " + command;
        return;
    },
    renderCommandLine: function () {
        this.window.cursor(this.window.height-1, 0);
        this.window.clrtoeol();
        if (this.mode == this.MODE_COMMAND) {
            // show command
            this.window.cursor(this.window.height-1, 0);
            this.window.addstr(this.window.height-1, 0, this.commandHeader + this.commandBuffer);
        }
        if (this.error) {
            // show error message
            this.window.cursor(this.window.height-1, 0);
            this.window.attron(this.COLOR_ERROR_MESSAGE);
            this.window.addstr(this.window.height-1, 0, this.error);
            this.window.attroff(this.COLOR_ERROR_MESSAGE);
            process.nextTick(function () {
                HoshiPad.error = null;
            });
        } else if (this.message) {
            // show message
            this.window.cursor(this.window.height-1, 0);
            this.window.attron(this.COLOR_MESSAGE);
            this.window.addstr(this.window.height-1, 0, this.message);
            this.window.attroff(this.COLOR_MESSAGE);
            process.nextTick(function () {
                HoshiPad.message = null;
            });
        }
    },
    renderMainWindow: function() {
        this.window.cursor(0,0);
        for (var y=0; y<this.window.height-2; y++) {
            var txt = this.buffer.getText(this.lineno-this.cursorY+y);
            this.window.cursor(y, 0);
            this.window.clrtoeol();
            this.window.addstr(y, 0, txt);
        }
    },
    redraw: function () {
        HoshiPad.renderMainWindow();
        HoshiPad.showModeLine();
        HoshiPad.renderCommandLine();
        if (this.mode == this.MODE_COMMAND) {
            HoshiPad.window.cursor(this.window.height-1, this.commandCursorX);
        } else {
            HoshiPad.window.cursor(this.cursorY, this.cursorX);
        }
        HoshiPad.window.refresh();
    }
};
HoshiPad.Buffer = function () {
    this.data = [];
};
HoshiPad.Buffer.prototype = {
    getLineCount: function () {
        return this.data.length;
    },
    getText: function (lineno) {
        return this.data[lineno] || '';
    },
    replaceText: function (lineno, text) {
        this.data[lineno] = text;
    },
    insertText: function (lineno, text) {
        this.data = this.data.slice(0, lineno).concat([text]).concat(this.data.slice(lineno+1, this.data.length));
    },
    toString: function () {
        return this.data.join("\n");
    },
    removeAll: function () {
        this.data = [];
    },
    removeLine: function (lineno) {
        HoshiPad.abort("...");
    }
};

// debugging server
http.createServer(function (req, res) {
    res.writeHead(200, {
        'content-type': 'application/json'
    });
    res.write(JSON.stringify(HoshiPad.buffer) + "\n");
    res.end();
}).listen(1270);

HoshiPad.init();
HoshiPad.redraw();

/**
 * segv:
 *  call nc.colorPair before new nc.Window()
 */

