const electron = require('electron');
console.log('type:', typeof electron);
console.log('keys:', Object.keys(electron || {}).slice(0, 5));
console.log('has app:', typeof electron.app);
console.log('default?', typeof electron.default);
if (electron.default) {
  console.log('default.app?', typeof electron.default.app);
}
process.exit(0);
