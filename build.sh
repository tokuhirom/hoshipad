#!/bin/sh
git submodule init
git submodule update
cd node_modules/node-ncurses/
node-waf configure build
