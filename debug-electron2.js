const { app } = require('electron');
console.log('app:', app);
console.log('isPackaged:', app && app.isPackaged);
app.on('ready', () => process.exit(0));
