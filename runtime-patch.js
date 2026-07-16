'use strict';

const fs = require('node:fs');
const originalReadFile = fs.readFile.bind(fs);

fs.readFile = function patchedReadFile(filePath, ...args) {
  const callback = args.at(-1);
  if (typeof callback !== 'function') return originalReadFile(filePath, ...args);

  args[args.length - 1] = function patchedCallback(error, data) {
    if (!error && /(?:^|[\\/])public[\\/]index\.html$/.test(String(filePath))) {
      const isBuffer = Buffer.isBuffer(data);
      const html = isBuffer ? data.toString('utf8') : String(data);
      const patched = html.includes('/calculator-display-fix.js')
        ? html
        : html.replace('</body>', '<script src="/calculator-display-fix.js"></script></body>');
      data = isBuffer ? Buffer.from(patched) : patched;
    }
    callback(error, data);
  };

  return originalReadFile(filePath, ...args);
};
