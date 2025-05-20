const vscode = require('vscode');

async function runPythonVersion() {
    const terminal = vscode.window.createTerminal('Python Version');
    terminal.sendText('python --version');
    terminal.show();
    return new Promise(resolve => setTimeout(resolve, 1000));
}

module.exports = {
    runPythonVersion
};