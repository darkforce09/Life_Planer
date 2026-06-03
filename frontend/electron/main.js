const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#121212', // Matches our dark theme
    autoHideMenuBar: true, // Hides the default Linux menu bar for a native feel
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // In development, load the Expo web server directly
  const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:8081';
  mainWindow.loadURL(startUrl);
  
  // Open DevTools to debug why the React Native view is blank
  mainWindow.webContents.openDevTools();

  // If in production, you would load the static web build instead:
  // mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
