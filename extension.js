const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { runPythonVersion } = require("./commands/pythonCommands");

let wordPanel = null;
const snippetsPath = path.join(__dirname, "snippets", "phs-snippets.json");
const snippets = JSON.parse(fs.readFileSync(snippetsPath, "utf-8"));

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// console.log('Congratulations, your extension "phenoscript" is now active!');

	let disposable = vscode.commands.registerCommand(
		"phenoscript.ShowOntologyTermInfo",
		function () {
			let editor = vscode.window.activeTextEditor;
			if (editor) {
				// let wordPattern = /[\w\-_.]+|( > | >> | < | << | -> | <- | |>| | |<| )/;
				let wordPattern =
					/[\w\-_.]+|( > | >> | < | << | -> | <- | \|\>\| | \|\<\| )/;

				let wordRange = editor.document.getWordRangeAtPosition(
					editor.selection.active,
					wordPattern
				);
				let word = editor.document.getText(wordRange);
				// console.log(word);

				let matchedSnippet = null;
				for (let key in snippets) {
					if (snippets[key].body.includes(word)) {
						matchedSnippet = snippets[key];
						break;
					}
				}

				let displayContent;
				if (matchedSnippet) {
					const typeMapping = {
						C: "Class",
						OP: "Object Property",
						DP: "Data Property",
						AP: "Annotation Property",
					};
					let typeText =
						typeMapping[matchedSnippet.type] || matchedSnippet.type; // Default to matchedSnippet.type if not found in the map

					displayContent = `
<div class="property-container">

	<div class="property-title">${word}</div>

	<div class="property-content">
    	<div class="property-description">
        	<span class="boxed-text" data-type="${typeText}">${typeText}</span>
    	</div>
	</div>

	<div class="property-content">
		<div class="property-description">
			<strong>Original label:</strong>
		</div>
		<div class="icon-and-label">
			<span class="property-icon" data-type="${typeText}"></span>
			<span class="label-text">${matchedSnippet.label_original}</span>
		</div>
	</div>
	
	<div class="property-content">
		<div class="property-description">
			<strong>Definition:</strong>
			<div class="description-text">${matchedSnippet.description}</div>
			<div class="description-text"><a href="${matchedSnippet.iri}" class="iri-link">${matchedSnippet.iri}</a></div>
		</div>
	</div>

</div>
`;
				} else {
					displayContent = `
<div class="property-container">

	<div class="property-title">${word}</div>

	<div class="property-content">
		<div class="property-description-red">
			<strong>No mathch found! This term is absent in phs-snippets.json</strong>
		</div>
	</div>

</div>
`;
				}

				if (!wordPanel) {
					wordPanel = vscode.window.createWebviewPanel(
						"wordDisplay",
						"Term Info",
						vscode.ViewColumn.Two,
						{}
					);
					wordPanel.onDidDispose(() => {
						wordPanel = null;
					});
				}

				// Now that wordPanel is guaranteed to be initialized, you can create cssUri
				const cssPath = vscode.Uri.file(
					path.join(context.extensionPath, "webview", "styles.css")
				);
				const cssUri = wordPanel.webview.asWebviewUri(cssPath);

				wordPanel.webview.html = `
				<html>
					<head>
						<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${wordPanel.webview.cspSource};">
						<link href="${cssUri}" rel="stylesheet">
					</head>
					<body>${displayContent}</body>
				</html>`;
			}
		}
	);

	context.subscriptions.push(disposable);

	// Register WebView Provider
	const provider = new PHSSidebarViewProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider("phsSidebar", provider)
	);
}

class PHSSidebarViewProvider {
	constructor(extensionUri, context) {
		this._extensionUri = extensionUri;
		this._context = context;
		// Store terminal references
		this._pythonTerminal = undefined;
		this._bashTerminal = undefined;
		this._phenoscriptTerminal = undefined;  // Add new terminal reference
		
		// Clean up terminal references when they're closed
		context.subscriptions.push(
			vscode.window.onDidCloseTerminal((terminal) => {
				if (terminal === this._pythonTerminal) {
					this._pythonTerminal = undefined;
				}
				if (terminal === this._bashTerminal) {
					this._bashTerminal = undefined;
				}
				if (terminal === this._phenoscriptTerminal) {
					this._phenoscriptTerminal = undefined;
				}
			})
		);
	}

	resolveWebviewView(webviewView, context, _token) {
		webviewView.webview.options = {
			enableScripts: true,
		};

		const sidebarPath = path.join(
			this._extensionUri.fsPath,
			"webview",
			"sidebar.html"
		);
		webviewView.webview.html = fs.readFileSync(sidebarPath, "utf8");

		webviewView.webview.onDidReceiveMessage(async (message) => {
			switch (message.command) {
				case "runPython":
					try {
						// Reuse existing Python terminal or create new one
						if (
							!this._pythonTerminal ||
							this._pythonTerminal.exitStatus !== undefined
						) {
							this._pythonTerminal =
								vscode.window.terminals.find(
									(t) => t.name === "Python Version"
								) ||
								vscode.window.createTerminal("Python Version");
						}
						this._pythonTerminal.show();
						this._pythonTerminal.sendText("python --version");
						vscode.window.showInformationMessage(
							"Python version check completed"
						);
					} catch (error) {
						vscode.window.showErrorMessage("Failed to check Python version");
					}
					break;

				case "runBash":
					try {
						// Reuse existing Bash terminal or create new one
						if (
							!this._bashTerminal ||
							this._bashTerminal.exitStatus !== undefined
						) {
							this._bashTerminal =
								vscode.window.terminals.find(
									(t) => t.name === "Bash Command"
								) ||
								vscode.window.createTerminal("Bash Command");
						}
						this._bashTerminal.show();
						this._bashTerminal.sendText(message.bashCommand);
					} catch (error) {
						vscode.window.showErrorMessage("Failed to execute bash command");
					}
					break;

				case "createProject":
					try {
						// Show folder picker
						const folder = await vscode.window.showOpenDialog({
							canSelectFiles: false,
							canSelectFolders: true,
							canSelectMany: false,
							title: "Select Parent Folder for New PhenoScript Project",
						});

						if (folder && folder[0]) {
							// Create project name input
							const projectName = await vscode.window.showInputBox({
								prompt: "Enter project name",
								placeHolder: "my_phenoscript_project",
							});

							if (projectName) {
								const targetDir = path.join(folder[0].fsPath, projectName);
								const sourceDir = path.join(
									this._extensionUri.fsPath,
									"dir-create",
									"main"
								);

								// Create target directory
								await fs.promises.mkdir(targetDir, { recursive: true });

								// Copy directory recursively
								await this.copyDirectory(sourceDir, targetDir);

								// Add folder to workspace
								const uri = vscode.Uri.file(targetDir);
								vscode.workspace.updateWorkspaceFolders(
									vscode.workspace.workspaceFolders
										? vscode.workspace.workspaceFolders.length
										: 0,
									null,
									{ uri }
								);

								vscode.window.showInformationMessage(
									`Project created at ${targetDir}`
								);
							}
						}
					} catch (error) {
						vscode.window.showErrorMessage(
							`Failed to create project: ${error.message}`
						);
						console.error(error);
					}
					break;

				case "convertPhs":
					try {
						// Get active editor
						const editor = vscode.window.activeTextEditor;
						if (!editor) {
							vscode.window.showErrorMessage('No active PHS file');
							return;
						}

						// Check if it's a .phs file
						if (!editor.document.fileName.endsWith('.phs')) {
							vscode.window.showErrorMessage('Active file is not a PHS file');
							return;
						}

						// Get file paths
						const filePath = editor.document.fileName;
						const fileName = path.basename(filePath);
						const workspaceFolder = path.dirname(path.dirname(filePath)); // parent of phenotypes dir

						// Create output directory structure
						const outputBaseDir = path.join(workspaceFolder, 'output');
						const outputRdfPath = path.join(outputBaseDir, 'output_rdf');
						const outputHtmlPath = path.join(outputBaseDir, 'output_html');
						
						// Create directories if they don't exist
						if (!fs.existsSync(outputBaseDir)) {
							fs.mkdirSync(outputBaseDir, { recursive: true });
						}
						if (!fs.existsSync(outputRdfPath)) {
							fs.mkdirSync(outputRdfPath, { recursive: true });
						}
						if (!fs.existsSync(outputHtmlPath)) {
							fs.mkdirSync(outputHtmlPath, { recursive: true });
						}

						// Reuse existing terminal or create new one
						if (!this._phenoscriptTerminal || this._phenoscriptTerminal.exitStatus !== undefined) {
							this._phenoscriptTerminal = vscode.window.terminals.find(
								(t) => t.name === 'PhenoScript Converter'
							) || vscode.window.createTerminal('PhenoScript Converter');
						}

						// Show and clear terminal
						this._phenoscriptTerminal.show();
						this._phenoscriptTerminal.sendText('clear');

						// Run docker command with updated paths
						const dockerCommand = `docker run \\
    -v "${workspaceFolder}/phenotypes:/app/phenotypes" \\
    -v "${outputRdfPath}:/app/output_rdf" \\
    -v "${outputHtmlPath}:/app/output_html" \\
    -e PHS_FILE=${fileName} \\
    phenospy-converter`;

        this._phenoscriptTerminal.sendText(dockerCommand);
        
        vscode.window.showInformationMessage('Converting PHS file...');
					} catch (error) {
						vscode.window.showErrorMessage(`Failed to convert PHS file: ${error.message}`);
						console.error(error);
					}
					break;
			}
		});
	}

	// Add this helper method to copy directories recursively
	async copyDirectory(src, dest) {
		const entries = await fs.promises.readdir(src, { withFileTypes: true });

		await fs.promises.mkdir(dest, { recursive: true });

		for (const entry of entries) {
			const srcPath = path.join(src, entry.name);
			const destPath = path.join(dest, entry.name);

			if (entry.isDirectory()) {
				await this.copyDirectory(srcPath, destPath);
			} else {
				await fs.promises.copyFile(srcPath, destPath);
			}
		}
	}
}

function deactivate() {}

module.exports = {
	activate,
	deactivate,
};
