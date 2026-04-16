#!/usr/bin/env node
'use strict';

const path = require('path');
const os = require('os');

const binName = os.platform() === 'win32' ? 'deep-filter.exe' : 'deep-filter';
module.exports = path.join(__dirname, binName);
