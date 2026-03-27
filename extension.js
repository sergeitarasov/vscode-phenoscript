const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

let wordPanel = null;
const snippetsPath = path.join(__dirname, "snippets", "phs-snippets.json");
const snippets = JSON.parse(fs.readFileSync(snippetsPath, "utf-8"));

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// console.log('Congratulations, your extension "phenoscript" is now active!');

	// After adding the very first workspace folder VS Code reloads the window.
	// We persist the config path in globalState before the reload so we can
	// open it and show the setup prompt once the extension re-activates.
	const pendingConfig = context.globalState.get('pendingConfigOpen');
	if (pendingConfig) {
		context.globalState.update('pendingConfigOpen', undefined);
		setTimeout(async () => {
			try {
				await vscode.commands.executeCommand('workbench.view.explorer');
				const configUri = vscode.Uri.file(pendingConfig.configPath);
				await vscode.window.showTextDocument(configUri);
				await vscode.window.showInformationMessage(
					`Project '${pendingConfig.projectName}' created!\n\nPlease fill in your name, ORCID ID, and project title in phs-config.yaml.`,
					{ modal: true },
					'OK'
				);
			} catch (e) {
				console.error('PhenoScript: post-reload setup failed', e);
			}
		}, 1500);
	}

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
		this._phenoscriptTerminal = undefined;
		this._outputChannel = vscode.window.createOutputChannel('PhenoScript');
		context.subscriptions.push(this._outputChannel);

		// Clean up terminal reference when it's closed
		context.subscriptions.push(
			vscode.window.onDidCloseTerminal((terminal) => {
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
				case "createProject":
					try {
						// Show folder picker
						const folder = await vscode.window.showOpenDialog({
							canSelectFiles: false,
							canSelectFolders: true,
							canSelectMany: false,
							title: "Select a directory for your new PhenoScript project",
							openLabel: "Select Directory",
						});

						if (folder && folder[0]) {
							// Ask for project name — user can choose any name
							const projectName = await vscode.window.showInputBox({
								prompt: "Enter a name for your new PhenoScript project",
								placeHolder: "my_phenoscript_project",
								validateInput: (val) => val.trim() ? null : "Project name cannot be empty",
							});

							if (projectName) {
								const targetDir = path.join(folder[0].fsPath, projectName.trim());
								const templateDir = path.join(
									this._extensionUri.fsPath,
									"dir-create",
									"main"
								);

								// Create project structure
								const phenotypesDir = path.join(targetDir, "phenotypes");
								const sourceOntologiesDir = path.join(targetDir, "source_ontologies");
								const owlRawDir = path.join(targetDir, "output", "owl_init");
								const utilsDir = path.join(targetDir, "utils");
								await fs.promises.mkdir(phenotypesDir, { recursive: true });
								await fs.promises.mkdir(sourceOntologiesDir, { recursive: true });
								await fs.promises.mkdir(owlRawDir, { recursive: true });
								await fs.promises.mkdir(utilsDir, { recursive: true });
								await fs.promises.mkdir(path.join(targetDir, "output", "log-shacl"), { recursive: true });
								await fs.promises.mkdir(path.join(targetDir, "output", "log-materializer"), { recursive: true });
								await fs.promises.mkdir(path.join(targetDir, "output", "abox"), { recursive: true });
								await fs.promises.mkdir(path.join(targetDir, "output", "kb"), { recursive: true });

								// Copy only the required template files into phenotypes/
								const templateFiles = ["phs-config.yaml", "my_species.yphs"];
								for (const file of templateFiles) {
									await fs.promises.copyFile(
										path.join(templateDir, "phenotypes", file),
										path.join(phenotypesDir, file)
									);
								}

								// Copy utils files (shacl shapes + annotate query)
								const utilsFiles = ["phenoscript.shacl.ttl", "annotate.ru"];
								for (const file of utilsFiles) {
									const src = path.join(templateDir, "utils", file);
									if (fs.existsSync(src)) {
										await fs.promises.copyFile(src, path.join(utilsDir, file));
									}
								}

								const uri = vscode.Uri.file(targetDir);
								vscode.workspace.updateWorkspaceFolders(
									vscode.workspace.workspaceFolders
										? vscode.workspace.workspaceFolders.length
										: 0,
									null,
									{ uri }
								);

								// If the window was NOT reloaded (folder added to existing workspace),
								// the globalState flag is still set — handle it inline and clear it.
								setTimeout(async () => {
									const pending = this._context.globalState.get('pendingConfigOpen');
									if (!pending) return;
									await this._context.globalState.update('pendingConfigOpen', undefined);
									try {
										await vscode.commands.executeCommand('workbench.view.explorer');
										const configUri = vscode.Uri.file(pending.configPath);
										await vscode.window.showTextDocument(configUri);
										await vscode.window.showInformationMessage(
											`Project '${pending.projectName}' created!\n\nPlease fill in your name, ORCID ID, and project title in phs-config.yaml.`,
											{ modal: true },
											'OK'
										);
									} catch (e) {
										console.error('PhenoScript: post-create setup failed', e);
									}
								}, 800);

								// Persist the config path so the post-reload handler in activate()
								// can open it after VS Code reloads the window (first folder added).
								await this._context.globalState.update('pendingConfigOpen', {
									configPath: path.join(phenotypesDir, 'phs-config.yaml'),
									projectName: projectName.trim(),
								});

								// Add folder to workspace (may reload the window if this is the first folder)
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
							vscode.window.showErrorMessage('No active PhenoScript file. Open a .phs or .yphs file first.');
							return;
						}

						// Accept both .phs (plain text) and .yphs (YAML-block) formats
						if (!/\.(phs|yphs)$/.test(editor.document.fileName)) {
							vscode.window.showErrorMessage('Active file must be a .phs or .yphs PhenoScript file.');
							return;
						}

						const filePath = editor.document.fileName;
						const fileName = path.basename(filePath);
						const projectDir = path.dirname(path.dirname(filePath)); // parent of phenotypes/
						const phenotypesDir = path.join(projectDir, 'phenotypes');
						const owlRawDir = path.join(projectDir, 'output', 'owl_init');
						const nlDir = path.join(projectDir, 'output', 'nl');
							const utilsDir = path.join(projectDir, 'utils');
							const logShaclDir = path.join(projectDir, 'output', 'log-shacl');
							const snippetsDir = path.join(this._extensionUri.fsPath, 'snippets');

							// NL format chosen in the sidebar (html | md | both)
							const nlFormat = message.nlFormat || 'html';
							// GBIF taxonomy flag — adds -g to phenospy yphs2owl when true
							const gbif = message.gbif !== false; // default true

							// Ensure output dirs exist (in case user didn't use Create Project)
							await fs.promises.mkdir(owlRawDir, { recursive: true });
							await fs.promises.mkdir(nlDir, { recursive: true });
							await fs.promises.mkdir(logShaclDir, { recursive: true });
							// utils/ may not exist if project was created without it — skip gracefully
							await fs.promises.mkdir(utilsDir, { recursive: true });
						const toDockerPath = (p) => p.split(path.sep).join('/');

						// On Windows with Git Bash, MSYS path conversion mangles container-side
						// paths like :/app/input into Windows paths — disable it.
						// PowerShell and CMD don't support inline env-var prefix, so only apply
						// this when the active shell is bash on Windows.
						const activeShell = vscode.env.shell || '';
						const isWinGitBash = process.platform === 'win32' && /bash/i.test(activeShell);
						const envPrefix = isWinGitBash ? 'MSYS_NO_PATHCONV=1 ' : '';

						// Reuse or create terminal
						if (!this._phenoscriptTerminal || this._phenoscriptTerminal.exitStatus !== undefined) {
							this._phenoscriptTerminal = vscode.window.terminals.find(
								(t) => t.name === 'PhenoScript'
							) || vscode.window.createTerminal('PhenoScript');
						}
						this._phenoscriptTerminal.show();
						this._phenoscriptTerminal.sendText('clear');

						// Volume mounts:
						//   /app/input     ← project phenotypes/ (contains .yphs + phs-config.yaml)
						//   /app/snippets  ← extension snippets/ (provides phs-snippets.json)
						//   /app/output    ← project output/owl_init/ (receives .owl + .xml)
						//   /app/nl_output ← project output/nl/ (receives .html / .md)
						//   /app/utils     ← project utils/ (contains shacl shapes)
						//   /app/log-shacl ← project output/log-shacl/ (receives shacl logs)
						const dockerCommand =
							envPrefix +
							'docker run --rm' +
							` -v "${toDockerPath(phenotypesDir)}:/app/input"` +
							` -v "${toDockerPath(snippetsDir)}:/app/snippets"` +
							` -v "${toDockerPath(owlRawDir)}:/app/output"` +
							` -v "${toDockerPath(nlDir)}:/app/nl_output"` +
							` -v "${toDockerPath(utilsDir)}:/app/utils"` +
							` -v "${toDockerPath(logShaclDir)}:/app/log-shacl"` +
							` -e PHS_FILE=${fileName}` +
							` -e NL_FORMAT=${nlFormat}` +
							` -e GBIF_FLAG=${gbif ? '1' : '0'}` +
							' sergeit215/phenoscript-docker:latest';

						this._phenoscriptTerminal.sendText(dockerCommand);
						vscode.window.showInformationMessage(`Converting ${fileName} to OWL + natural language (${nlFormat})...`);
					} catch (error) {
						vscode.window.showErrorMessage(`Conversion failed: ${error.message}`);
						console.error(error);
					}
					break;

				case "getOntologies":
					try {
						// Resolve project dir from active editor or first matching workspace folder
						let projectDir = null;
						const activeEditor = vscode.window.activeTextEditor;
						if (activeEditor) {
							const dir = path.dirname(activeEditor.document.fileName);
							if (fs.existsSync(path.join(dir, 'phs-config.yaml'))) {
								projectDir = path.dirname(dir); // active file is inside phenotypes/
							} else if (fs.existsSync(path.join(dir, 'phenotypes', 'phs-config.yaml'))) {
								projectDir = dir;
							}
						}
						if (!projectDir && vscode.workspace.workspaceFolders) {
							for (const wf of vscode.workspace.workspaceFolders) {
								if (fs.existsSync(path.join(wf.uri.fsPath, 'phenotypes', 'phs-config.yaml'))) {
									projectDir = wf.uri.fsPath;
									break;
								}
							}
						}
						if (!projectDir) {
							vscode.window.showErrorMessage('No PhenoScript project found. Open a project folder first.');
							return;
						}

						const phenotypesDir = path.join(projectDir, 'phenotypes');
						const sourceOntologiesDir = path.join(projectDir, 'source_ontologies');

						// Ensure directories exist
						await fs.promises.mkdir(sourceOntologiesDir, { recursive: true });

						const toDockerPath = (p) => p.split(path.sep).join('/');
						const activeShell = vscode.env.shell || '';
						const isWinGitBash = process.platform === 'win32' && /bash/i.test(activeShell);
						const envPrefix = isWinGitBash ? 'MSYS_NO_PATHCONV=1 ' : '';

						if (!this._phenoscriptTerminal || this._phenoscriptTerminal.exitStatus !== undefined) {
							this._phenoscriptTerminal = vscode.window.terminals.find(
								(t) => t.name === 'PhenoScript'
							) || vscode.window.createTerminal('PhenoScript');
						}
						this._phenoscriptTerminal.show();
						this._phenoscriptTerminal.sendText('clear');

						// Commands run inside the container:
						// Write pipeline to temp script — avoids inline quoting issues on all platforms
						const tmpOntoScript = path.join(os.tmpdir(), 'phs-get-ontos.sh');
						await fs.promises.writeFile(tmpOntoScript, [
							'#!/bin/sh',
							'set -e',
							'phenospy fetch-ontos /app/input/phs-config.yaml /app/source_ontologies',
							'echo "=== All ontologies downloaded ==="',
							'echo "=== robot: merging ontologies into tbox.owl... ==="',
							'robot merge --inputs "/app/source_ontologies/*.owl" --output /app/source_ontologies/tbox.owl',
							'echo "=== robot: removing individuals from tbox.owl... ==="',
							'robot remove --input /app/source_ontologies/tbox.owl --select individuals --output /app/source_ontologies/tbox.owl',
							'echo "=== Done: tbox.owl is ready ==="',
						].join('\n') + '\n', { mode: 0o755 });

						const ontoDockerCommand =
							envPrefix +
							'docker run --rm' +
							` -v "${toDockerPath(phenotypesDir)}:/app/input"` +
							` -v "${toDockerPath(sourceOntologiesDir)}:/app/source_ontologies"` +
							` -v "${toDockerPath(tmpOntoScript)}:/app/run.sh"` +
							' --entrypoint /bin/sh' +
							' sergeit215/phenoscript-docker:latest' +
							' /app/run.sh';

						this._phenoscriptTerminal.sendText(ontoDockerCommand);
						vscode.window.showInformationMessage('Fetching and merging ontologies...');
					} catch (error) {
						vscode.window.showErrorMessage(`Failed to get ontologies: ${error.message}`);
						console.error(error);
					}
					break;

				case "materialize":
					try {
						// Resolve project dir from active editor or workspace folders
						let projectDir = null;
						const activeEditor = vscode.window.activeTextEditor;
						if (activeEditor) {
							const dir = path.dirname(activeEditor.document.fileName);
							if (fs.existsSync(path.join(dir, 'phs-config.yaml'))) {
								projectDir = path.dirname(dir);
							} else if (fs.existsSync(path.join(dir, 'phenotypes', 'phs-config.yaml'))) {
								projectDir = dir;
							}
						}
						if (!projectDir && vscode.workspace.workspaceFolders) {
							for (const wf of vscode.workspace.workspaceFolders) {
								if (fs.existsSync(path.join(wf.uri.fsPath, 'phenotypes', 'phs-config.yaml'))) {
									projectDir = wf.uri.fsPath;
									break;
								}
							}
						}
						if (!projectDir) {
							vscode.window.showErrorMessage('No PhenoScript project found. Open a project folder first.');
							return;
						}

						const projectName = path.basename(projectDir);
						const owlInitDir       = path.join(projectDir, 'output', 'owl_init');
						const sourceOntologiesDir = path.join(projectDir, 'source_ontologies');
						const aboxDir          = path.join(projectDir, 'output', 'abox');
						const utilsDir         = path.join(projectDir, 'utils');
						const logMaterializerDir = path.join(projectDir, 'output', 'log-materializer');
						const kbDir            = path.join(projectDir, 'output', 'kb');

						// Ensure output dirs exist
						await fs.promises.mkdir(aboxDir, { recursive: true });
						await fs.promises.mkdir(logMaterializerDir, { recursive: true });
						await fs.promises.mkdir(kbDir, { recursive: true });

						const toDockerPath = (p) => p.split(path.sep).join('/');
						const activeShell = vscode.env.shell || '';
						const isWinGitBash = process.platform === 'win32' && /bash/i.test(activeShell);
						const envPrefix = isWinGitBash ? 'MSYS_NO_PATHCONV=1 ' : '';

						if (!this._phenoscriptTerminal || this._phenoscriptTerminal.exitStatus !== undefined) {
							this._phenoscriptTerminal = vscode.window.terminals.find(
								(t) => t.name === 'PhenoScript'
							) || vscode.window.createTerminal('PhenoScript');
						}
						this._phenoscriptTerminal.show();
						this._phenoscriptTerminal.sendText('clear');

						// Write pipeline to a temp script to avoid terminal paste-length limits
						const scriptLines = [
							'#!/bin/sh',
							'set -e',
							'echo "=== robot: merging OWL files into abox-merged.owl... ==="',
							'robot merge --inputs "/app/owl_init/*.owl" --output /app/abox/abox-merged.owl',
							'echo "=== materializer: inferring axioms (whelk reasoner)... ==="',
							'materializer file --ontology-file /app/source_ontologies/tbox.owl --input /app/abox/abox-merged.owl --output /app/abox/abox-whelk-raw.ttl --reasoner whelk > /app/log-materializer/materializer.log 2>&1',
							'echo "=== robot: annotating inferred axioms... ==="',
							'update --update /app/utils/annotate.ru --data /app/abox/abox-whelk-raw.ttl --dump > /app/abox/abox-whelk-annotated.ttl',
							'echo "=== riot: building knowledge base... ==="',
							`riot /app/abox/abox-merged.owl /app/abox/abox-whelk-annotated.ttl /app/source_ontologies/tbox.owl > /app/kb/${projectName}-kb.ttl`,
							`echo "=== Done: output/kb/${projectName}-kb.ttl is ready ==="`,
							'if grep -q "Inconsistent dataset" /app/log-materializer/materializer.log; then echo "=== WARNING: Inconsistent dataset detected! Your ABox (less likely TBox) is inconsistent. Check your PhenoScript files for illogical statements, then re-run Convert to OWL and Materialize (ABox -> KB). ==="; else echo "=== Success: your dataset is consistent. ==="; fi',
						];
						const tmpScript = path.join(os.tmpdir(), 'phs-materialize.sh');
						await fs.promises.writeFile(tmpScript, scriptLines.join('\n') + '\n', { mode: 0o755 });

						const materializeCommand =
							envPrefix +
							'docker run --rm' +
							` -v "${toDockerPath(owlInitDir)}:/app/owl_init"` +
							` -v "${toDockerPath(sourceOntologiesDir)}:/app/source_ontologies"` +
							` -v "${toDockerPath(aboxDir)}:/app/abox"` +
							` -v "${toDockerPath(utilsDir)}:/app/utils"` +
							` -v "${toDockerPath(logMaterializerDir)}:/app/log-materializer"` +
							` -v "${toDockerPath(kbDir)}:/app/kb"` +
							` -v "${toDockerPath(tmpScript)}:/app/run.sh"` +
							' --entrypoint /bin/sh' +
							' sergeit215/phenoscript-docker:latest' +
							' /app/run.sh';

						this._phenoscriptTerminal.sendText(materializeCommand);
						vscode.window.showInformationMessage(`Materializing ${projectName}...`);
					} catch (error) {
						vscode.window.showErrorMessage(`Materialization failed: ${error.message}`);
						console.error(error);
					}
					break;
				case "submit":
					try {
						// Resolve project dir
						let projectDir = null;
						const activeEditor = vscode.window.activeTextEditor;
						if (activeEditor) {
							const dir = path.dirname(activeEditor.document.fileName);
							if (fs.existsSync(path.join(dir, 'phs-config.yaml'))) {
								projectDir = path.dirname(dir);
							} else if (fs.existsSync(path.join(dir, 'phenotypes', 'phs-config.yaml'))) {
								projectDir = dir;
							}
						}
						if (!projectDir && vscode.workspace.workspaceFolders) {
							for (const wf of vscode.workspace.workspaceFolders) {
								if (fs.existsSync(path.join(wf.uri.fsPath, 'phenotypes', 'phs-config.yaml'))) {
									projectDir = wf.uri.fsPath;
									break;
								}
							}
						}
						if (!projectDir) {
							vscode.window.showErrorMessage('No PhenoScript project found. Open a project folder first.');
							return;
						}

						const projectName = path.basename(projectDir);
						const logShaclDir = path.join(projectDir, 'output', 'log-shacl');
						const materializerLog = path.join(projectDir, 'output', 'log-materializer', 'materializer.log');
						const submitDir = path.join(projectDir, 'submit');

						// Always delete any existing zip files in submit/ before checking
						await fs.promises.mkdir(submitDir, { recursive: true });
						for (const f of await fs.promises.readdir(submitDir)) {
							if (f.endsWith('.zip')) {
								await fs.promises.unlink(path.join(submitDir, f));
							}
						}

						// --- Check SHACL logs ---
						const shaclFailed = [];
						if (!fs.existsSync(logShaclDir) || fs.readdirSync(logShaclDir).filter(f => f.endsWith('.txt')).length === 0) {
							shaclFailed.push('__no_logs__');
						} else {
							const logFiles = fs.readdirSync(logShaclDir).filter(f => f.endsWith('.txt'));
							for (const logFile of logFiles) {
								const content = fs.readFileSync(path.join(logShaclDir, logFile), 'utf8');
								if (!content.includes('Conforms')) {
									// Strip .shacl.txt suffix to show the source filename
									const sourceName = logFile.replace(/\.shacl\.txt$/, '.yphs');
									shaclFailed.push(sourceName);
								}
							}
						}

						// --- Check materializer log ---
						let materializerMissing = false;
						let materializerInconsistent = false;
						if (!fs.existsSync(materializerLog)) {
							materializerMissing = true;
						} else {
							const content = fs.readFileSync(materializerLog, 'utf8');
							if (content.includes('Inconsistent')) {
								materializerInconsistent = true;
							}
						}

						const hasErrors = shaclFailed.length > 0 || materializerMissing || materializerInconsistent;

						// Build summary lines in JS
						const lines = ['=== Submission Check ==='];

						if (materializerMissing) {
							lines.push('Reasoner (whelk): No log found. Run Materialize (ABox -> KB) first.');
						} else if (materializerInconsistent) {
							lines.push('Reasoner (whelk): FAILED — inconsistent dataset. Fix illogical statements.');
							// lines.push('                  PhenoScript files, then re-run Convert to OWL and Materialize.');
						} else {
							lines.push('Reasoner (whelk): Passed');
						}

						if (shaclFailed.includes('__no_logs__')) {
							lines.push('SHACL:            No log files found. Run Convert to OWL + Text first.');
						} else if (shaclFailed.length > 0) {
							lines.push('SHACL:            FAILED');
							for (const fname of shaclFailed) {
								lines.push(`                  - ${fname}`);
							}
						} else {
							lines.push('SHACL:            Passed');
						}

						lines.push('');

						if (hasErrors) {
							lines.push('Submission package was NOT created.');
							lines.push('Fix the issues above and rerun the full pipeline.');
						}

						// Show summary in VS Code Output Channel — no shell required, works on all platforms
						this._outputChannel.clear();
						this._outputChannel.show(true);
						for (const line of lines) { this._outputChannel.appendLine(line); }

						if (hasErrors) {
							vscode.window.showWarningMessage('Submission check failed. See PhenoScript output panel for details.');
						} else {
							const phenotypesDir = path.join(projectDir, 'phenotypes');
							const zipPath = path.join(submitDir, `${projectName}.zip`);
							try {
								await new Promise((resolve, reject) => {
									if (process.platform === 'win32') {
										// Windows: PowerShell Compress-Archive (available Win 10+)
										cp.spawn('powershell', [
											'-NoProfile', '-Command',
											`Compress-Archive -Path "${phenotypesDir}\\*" -DestinationPath "${zipPath}" -Force`,
										], { windowsHide: true })
											.on('error', reject)
											.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Compress-Archive exited ${code}`)));
									} else {
										// macOS / Linux: zip
										cp.exec(`zip -q -r "${zipPath}" .`, { cwd: phenotypesDir }, (err) => (err ? reject(err) : resolve()));
									}
								});
								this._outputChannel.appendLine(`Package saved to: ${zipPath}`);
								vscode.window.showInformationMessage(`Submission package ready: submit/${projectName}.zip`);
							} catch (zipErr) {
								this._outputChannel.appendLine(`ERROR: Failed to create zip: ${zipErr.message}`);
								vscode.window.showErrorMessage(`Failed to create zip: ${zipErr.message}`);
							}
						}
					} catch (error) {
						vscode.window.showErrorMessage(`Submission preparation failed: ${error.message}`);
						console.error(error);
					}
					break;
			}
		});
	}

}

function deactivate() {}

module.exports = {
	activate,
	deactivate,
};
