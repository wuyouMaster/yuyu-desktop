import { app } from 'electron'
import path from 'path'
import { chooseUserDataRoot, getUserDataRoots, YUYU_RUNTIME_NAME } from './app-data-paths'

app.setName(YUYU_RUNTIME_NAME)
const roots = getUserDataRoots(app.getPath('appData'))
const selectedUserData = chooseUserDataRoot({ ...roots, isolated: process.env['YUYU_USER_DATA'] })
app.setPath('userData', selectedUserData)
app.setPath('sessionData', selectedUserData)

if (process.env['YUYU_USER_DATA']?.trim()) {
  app.setPath('logs', path.join(selectedUserData, 'logs'))
} else if (process.platform === 'darwin') {
  app.setPath('logs', path.join(app.getPath('home'), 'Library', 'Logs', 'YUYU'))
} else if (process.platform === 'win32') {
  app.setPath('logs', path.join(selectedUserData, 'logs'))
}
