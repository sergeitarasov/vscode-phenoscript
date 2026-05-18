const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const net = require("net");
const http = require("http");

let wordPanel = null;
const snippetsPath = path.join(__dirname, "snippets", "phs-snippets.json");
const snippets = JSON.parse(fs.readFileSync(snippetsPath, "utf-8"));

// State for the running Sparklis/Fuseki session
let sparklisSession = null; // { containerId, fusekiPort, httpdPort, statusBarItem, server }

/** Find a free TCP port */
function findFreePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(0, '127.0.0.1', () => {
			const port = srv.address().port;
			srv.close(() => resolve(port));
		});
		srv.on('error', reject);
	});
}

/**
 * Write a docker command to a temp launcher script and return the short shell
 * invocation to send to the terminal.  This avoids hitting shell command-line
 * length limits (cmd.exe: ~8191 chars) when paths are long.
 *
 * @param {string} dockerCmd  Full `docker run …` command (no env-prefix needed)
 * @param {string} baseName   Base filename without extension, e.g. 'phs-convert-docker'
 * @returns {Promise<string>} Short command to pass to terminal.sendText()
 */
async function writeDockerLaunchScript(dockerCmd, baseName) {
	const isWindows = process.platform === 'win32';
	const activeShell = vscode.env.shell || '';
	const isWinGitBash = isWindows && /bash/i.test(activeShell);
	const toDockerPath = (p) => p.split(path.sep).join('/');

	const pullCmd = 'docker pull sergeit215/phenoscript-docker:latest';

	if (isWindows && !isWinGitBash) {
		// PowerShell or cmd.exe — write a .bat file
		const scriptPath = path.join(os.tmpdir(), baseName + '.bat');
		await fs.promises.writeFile(scriptPath, `@echo off\r\n${pullCmd}\r\n${dockerCmd}\r\n`);
		// Double outer quotes handle spaces in %TEMP% path under cmd.exe
		return `cmd /c ""${scriptPath}""`;
	} else {
		// Mac / Linux / Windows Git Bash — write a .sh file
		const scriptPath = path.join(os.tmpdir(), baseName + '.sh');
		await fs.promises.writeFile(scriptPath, `#!/bin/sh\n${pullCmd}\n${dockerCmd}\n`, { mode: 0o755 });
		const envPrefix = isWinGitBash ? 'MSYS_NO_PATHCONV=1 ' : '';
		return `${envPrefix}sh "${toDockerPath(scriptPath)}"`;
	}
}

/** Poll until Fuseki answers or timeout (ms) */
function waitForFuseki(port, timeout = 30000) {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		function attempt() {
			const req = http.get(`http://127.0.0.1:${port}/$/ping`, (res) => {
				if (res.statusCode < 500) { resolve(); } else { retry(); }
				res.resume();
			});
			req.on('error', retry);
			req.end();
		}
		function retry() {
			if (Date.now() - start > timeout) { reject(new Error('Fuseki did not start in time')); return; }
			setTimeout(attempt, 1000);
		}
		attempt();
	});
}

/** Serve the bundled Sparklis webapp over HTTP on a given port */
function startSparklisHttpServer(sparklisDir, port) {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			let filePath = path.join(sparklisDir, req.url === '/' ? '/osparklis.html' : req.url);
			// Strip query string
			filePath = filePath.split('?')[0];
			fs.readFile(filePath, (err, data) => {
				if (err) { res.writeHead(404); res.end('Not found'); return; }
				const ext = path.extname(filePath).toLowerCase();
				const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
				               '.png': 'image/png', '.jpg': 'image/jpeg' }[ext] || 'application/octet-stream';
				res.writeHead(200, { 'Content-Type': mime });
				res.end(data);
			});
		});
		server.listen(port, '127.0.0.1', () => resolve(server));
		server.on('error', reject);
	});
}

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

	// Command: convert active .yphs file to PHS and open result as ephemeral preview
	const yphsToPhs = vscode.commands.registerCommand('phenoscript.yphsToPhs', async () => {
		try {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showErrorMessage('No active editor. Open a .yphs file first.');
				return;
			}
			if (!editor.document.fileName.endsWith('.yphs')) {
				vscode.window.showErrorMessage('YPHS \u2192 PHS only works on .yphs files.');
				return;
			}

			const fileContent = editor.document.getText();
			const toDockerPath = (p) => p.split(path.sep).join('/');
			const activeShell = vscode.env.shell || '';
			const isWinGitBash = process.platform === 'win32' && /bash/i.test(activeShell);

			// Write a minimal Python wrapper to a temp file
			const tmpScript = path.join(os.tmpdir(), 'phs-yphs2phs.py');
			const pyScript = [
				'import sys, os, yaml',
				'from phenospy import render_yphs_to_phs, get_phenospyPath',
				'tpl = os.path.join(get_phenospyPath(), "package-data", "yaml_temp", "phs_templates.yaml")',
				'template_data = yaml.safe_load(open(tpl, encoding="utf-8"))',
				'result = render_yphs_to_phs(sys.stdin.read(), template_data)',
				'sys.stdout.write(result)',
			].join('\n');
			await fs.promises.writeFile(tmpScript, pyScript, 'utf8');

			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Converting YPHS \u2192 PHS\u2026', cancellable: false },
				() => new Promise((resolve, reject) => {
					const dockerArgs = [
						'run', '--rm', '-i',
						'-v', `${toDockerPath(tmpScript)}:/app/run.py`,
						'--entrypoint', 'python',
						'sergeit215/phenoscript-docker:latest',
						'/app/run.py',
					];
					const proc = cp.spawn(
						isWinGitBash ? 'docker.exe' : 'docker',
						dockerArgs,
						{ env: { ...process.env, ...(isWinGitBash ? { MSYS_NO_PATHCONV: '1' } : {}) } }
					);
					proc.stdin.write(fileContent, 'utf8');
					proc.stdin.end();

					let stdout = '';
					let stderr = '';
					proc.stdout.on('data', (chunk) => { stdout += chunk; });
					proc.stderr.on('data', (chunk) => { stderr += chunk; });
					proc.on('close', async (code) => {
						if (code !== 0 || (!stdout && stderr)) {
							reject(new Error(stderr || `docker exited with code ${code}`));
							return;
						}
						try {
							const doc = await vscode.workspace.openTextDocument({ content: stdout, language: 'phs' });
							await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
							resolve();
						} catch (e) { reject(e); }
					});
					proc.on('error', reject);
				})
			);
		} catch (error) {
			vscode.window.showErrorMessage(`YPHS \u2192 PHS failed: ${error.message}`);
			console.error(error);
		}
	});
	context.subscriptions.push(yphsToPhs);

	// ── Browse with Sparklis ───────────────────────────────────────────────
	const browseRdf = vscode.commands.registerCommand('phenoscript.browseRdf', async (uri) => {
		try {
			const filePath = uri ? uri.fsPath : vscode.window.activeTextEditor?.document.fileName;
			if (!filePath) {
				vscode.window.showErrorMessage('No file selected. Right-click a .ttl or .owl file in the Explorer.');
				return;
			}
			const ext = path.extname(filePath).toLowerCase();
			if (ext !== '.ttl' && ext !== '.owl') {
				vscode.window.showErrorMessage('Browse with Sparklis only works on .ttl and .owl files.');
				return;
			}

			// Stop any previous session
			if (sparklisSession) {
				cp.exec(`docker stop ${sparklisSession.containerId}`, () => {});
				sparklisSession.server.close();
				sparklisSession.statusBarItem.dispose();
				sparklisSession = null;
			}

			const isWinGitBash = process.platform === 'win32' && /bash/i.test(vscode.env.shell || '');
			const toDockerPath = (p) => p.split(path.sep).join('/');

			const fusekiPort = await findFreePort();
			const sparklisSrcDir = path.join(__dirname, 'webview', 'sparklis');
			const sparklisSrvPort = await findFreePort();

			// Write a temp shell script that: starts Fuseki, waits, then loads the RDF file
			const tmpScript = path.join(os.tmpdir(), 'phs-sparklis.sh');
			const contentType = ext === '.owl' ? 'application/rdf+xml' : 'text/turtle';
			const sh = [
				'#!/bin/sh',
				`fuseki-server --port ${fusekiPort} --update --mem /ds &`,
				'FPID=$!',
				`until curl -sf http://127.0.0.1:${fusekiPort}/\\$/ping > /dev/null 2>&1; do sleep 0.5; done`,
				`curl -sf -X POST http://127.0.0.1:${fusekiPort}/ds/data --data-binary @/app/rdffile -H 'Content-Type: ${contentType}' -o /dev/null`,
				'wait $FPID',
			].join('\n') + '\n';
			fs.writeFileSync(tmpScript, sh, { mode: 0o755 });

			const dockerArgs = [
				'run', '--rm', '-d',
				'-p', `${fusekiPort}:${fusekiPort}`,
				'-v', `${toDockerPath(filePath)}:/app/rdffile:ro`,
				'-v', `${toDockerPath(tmpScript)}:/app/start.sh:ro`,
				'--entrypoint', '/bin/sh',
				'sergeit215/phenoscript-docker:latest',
				'/app/start.sh'
			];
			if (isWinGitBash) dockerArgs.unshift('MSYS_NO_PATHCONV=1');
			const proc = cp.spawnSync(
				isWinGitBash ? 'docker.exe' : 'docker',
				dockerArgs,
				{ env: { ...process.env, ...(isWinGitBash ? { MSYS_NO_PATHCONV: '1' } : {}) } }
			);
			if (proc.status !== 0) {
				throw new Error(proc.stderr?.toString().trim() || `docker exited with code ${proc.status}`);
			}
			const containerId = proc.stdout.toString().trim();

			// Start local HTTP server for Sparklis static files
			const httpServer = await startSparklisHttpServer(sparklisSrcDir, sparklisSrvPort);

			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'PhenoScript: starting Sparklis…', cancellable: false },
				() => waitForFuseki(fusekiPort)
			);

			const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
			statusBarItem.text = '$(debug-stop) Stop Sparklis';
			statusBarItem.command = 'phenoscript.stopRdfBrowser';
			statusBarItem.tooltip = 'Stop the running Sparklis / Fuseki session';
			statusBarItem.show();
			sparklisSession = { containerId, server: httpServer, statusBarItem, fusekiPort, sparklisSrvPort };

			const endpoint = encodeURIComponent(`http://localhost:${fusekiPort}/ds/sparql`);
			const rdfsLabel = encodeURIComponent('http://www.w3.org/2000/01/rdf-schema#label');
			const regexpHidden = encodeURIComponent('^(http://www.w3.org/2002/07/owl#|http://www.openlinksw.com/|nodeID://)');
			const sparkiisUrl = `http://localhost:${sparklisSrvPort}/osparklis.html?title=PhenoScript+KB` +
				`&endpoint=${endpoint}` +
				`&regexp_hidden_URIs=${regexpHidden}` +
				`&entity_lexicon_select=${rdfsLabel}` +
				`&concept_lexicons_select=${rdfsLabel}` +
				`&entity_tooltips_select=${rdfsLabel}` +
				`&concept_tooltips_select=${rdfsLabel}`;
			await vscode.env.openExternal(vscode.Uri.parse(sparkiisUrl));
			vscode.window.showInformationMessage('Sparklis browser open. Click "Stop Sparklis" in the status bar when done.');
		} catch (err) {
			vscode.window.showErrorMessage(`Browse with Sparklis failed: ${err.message}`);
		}
	});
	context.subscriptions.push(browseRdf);

	const stopRdfBrowser = vscode.commands.registerCommand('phenoscript.stopRdfBrowser', async () => {
		if (!sparklisSession) {
			vscode.window.showInformationMessage('No Sparklis session is running.');
			return;
		}
		cp.exec(`docker stop ${sparklisSession.containerId}`, (err) => {
			if (err) vscode.window.showErrorMessage(`Failed to stop container: ${err.message}`);
			else     vscode.window.showInformationMessage('Sparklis browser stopped.');
		});
		sparklisSession.server.close();
		sparklisSession.statusBarItem.dispose();
		sparklisSession = null;
	});
	context.subscriptions.push(stopRdfBrowser);

	// Register WebView Provider
	const syntaxDiagnostics = vscode.languages.createDiagnosticCollection('phenoscript-syntax');
	context.subscriptions.push(syntaxDiagnostics);

	const provider = new PHSSidebarViewProvider(context.extensionUri, context, syntaxDiagnostics);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider("phsSidebar", provider)
	);
}

/**
 * Returns true if the given stripped/trimmed statement text contains two consecutive
 * node tokens with no edge operator between them (e.g. "aism-antenna  aism-antennomere").
 *
 * Tokenises the line with a minimal regex and walks the token stream.
 * Edge tokens  : >  <  >>  <<  ->  <-  |>|  |<|  negated variants  dot-properties
 * Delimiter tokens: ( ) ,  — reset the "last was node" flag without being nodes
 * Node tokens  : identifiers (prefix-term[:tag]), numbers, strings, `this`
 */
function hasAdjacentNodes(text) {
	// Strip command lists e.g. [linksTraits = True] before tokenising
	const clean = text.replace(/\[[^\]]*\]/g, ' ');

	// Token regex — longer alternatives must come before shorter ones
	const TOKEN_RE = /\|>\||\|<\||>>|<<|->|<-|!(?:>>|<<|->|<-|[><])|\.[\w][\w\-.]*|'[^']*'|"[^"]*"|\d+(?:\.\d+)?|[><]|[\w][\w-]*(?::[\w\-\d]+)?|[(),;]/g;

	function isEdgeLike(t) {
		if (t === '>' || t === '<' || t === '>>' || t === '<<' ||
			t === '->' || t === '<-' || t === '|>|' || t === '|<|') return true;
		if (t[0] === '!') return true;  // negated edge (e.g. !>)
		if (t[0] === '.') return true;  // dot property  (e.g. .rdfs-label)
		return false;
	}

	let lastWasNode = false;
	let match;
	TOKEN_RE.lastIndex = 0;
	while ((match = TOKEN_RE.exec(clean)) !== null) {
		const t = match[0];
		if (t === ';') break;
		if (isEdgeLike(t) || t === '(' || t === ')' || t === ',') {
			lastWasNode = false;
		} else {
			// anything else is node-like (identifier, number, string)
			if (lastWasNode) return true; // two nodes in a row — missing edge
			lastWasNode = true;
		}
	}
	return false;
}

/**
 * Checks a PhenoScript (.yphs) document for statements missing a terminating semicolon.
 * Returns an array of vscode.Diagnostic (Warning severity) for each offending line.
 *
 * Algorithm:
 *   - Track brace depth; statement lines live at depth >= 2 (inside DATA={} / TRAITS={})
 *   - Strip line comments (#...) before analysing, but respect string literals
 *   - Skip structural lines (block headers like "OTU = {", "DATA = {", bare "{" / "}")
 *   - A line that doesn't end with ";" is OK if the NEXT content line starts with a
 *     continuation token (>, <, >>, <<, ->, <-, |>|, |<|, !, ., ,, (, )) meaning the
 *     statement continues on the next line.
 *   - Otherwise it's flagged as missing ";".
 *
 * @param {vscode.TextDocument} document
 * @returns {vscode.Diagnostic[]}
 */
function checkPhsSyntax(document) {
	// Operators that may legitimately start a continuation line
	const CONTINUATION_RE = /^\s*(?:>>|<<|->|<-|\|>\||<\||>|<|!|\.|,|\(|\))/;
	// Structural lines to skip: block headers or bare braces
	const STRUCTURAL_RE = /^\s*(?:\w[\w\s]*=\s*\{|[{}]\s*;?\s*)$/;

	/**
	 * Strip a #-initiated comment from a raw source line, respecting single- and
	 * double-quoted strings so a # inside a string is not treated as a comment.
	 */
	function stripComment(raw) {
		let inSingle = false;
		let inDouble = false;
		for (let i = 0; i < raw.length; i++) {
			const ch = raw[i];
			if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
			if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
			if (ch === '#' && !inSingle && !inDouble) {
				return raw.slice(0, i);
			}
		}
		return raw;
	}

	const diagnostics = [];
	const lineCount = document.lineCount;

	// Build a list of {lineIndex, text} for content lines inside DATA/TRAITS blocks
	let depth = 0;
	let inYamlBlock = false;
	/** @type {{lineIndex: number, text: string}[]} */
	const contentLines = [];

	for (let i = 0; i < lineCount; i++) {
		const raw = document.lineAt(i).text;

		// Track YAML block boundaries (raw line, before comment stripping)
		if (/^\s*#>>>YAML/.test(raw)) { inYamlBlock = true; continue; }
		if (/^\s*#<<<YAML/.test(raw)) { inYamlBlock = false; continue; }
		if (inYamlBlock) continue;

		const stripped = stripComment(raw).trim();

		// Update brace depth (count { and } in the stripped line)
		for (const ch of stripped) {
			if (ch === '{') depth++;
			else if (ch === '}') depth--;
		}

		if (stripped === '') continue;           // blank / comment-only line
		if (STRUCTURAL_RE.test(stripped)) continue; // OTU={, DATA={, TRAITS={, }, etc.
		if (depth < 2) continue;                 // outside a DATA/TRAITS block

		contentLines.push({ lineIndex: i, text: stripped });
	}

	// Walk collected lines and flag issues
	for (let j = 0; j < contentLines.length; j++) {
		const { lineIndex, text } = contentLines[j];

		// Check for adjacent nodes (missing edge operator) on this line
		if (hasAdjacentNodes(text)) {
			const line = document.lineAt(lineIndex);
			const range = new vscode.Range(
				new vscode.Position(lineIndex, 0),
				new vscode.Position(lineIndex, line.text.length)
			);
			const diag = new vscode.Diagnostic(
				range,
				'Missing edge operator: two nodes appear adjacent without ">" / ">>" / etc. between them',
				vscode.DiagnosticSeverity.Warning
			);
			diag.source = 'PhenoScript';
			diagnostics.push(diag);
			continue; // already flagged — skip semicolon check for this line
		}

		// Check for missing terminating semicolon
		if (text.endsWith(';')) continue; // properly terminated

		// Look at next content line (if any)
		const next = contentLines[j + 1];
		if (next && CONTINUATION_RE.test(next.text)) continue; // multi-line statement

		// Flag this line
		const line = document.lineAt(lineIndex);
		const range = new vscode.Range(
			new vscode.Position(lineIndex, 0),
			new vscode.Position(lineIndex, line.text.length)
		);
		const diag = new vscode.Diagnostic(
			range,
			'Missing semicolon: statement should end with ";"',
			vscode.DiagnosticSeverity.Warning
		);
		diag.source = 'PhenoScript';
		diagnostics.push(diag);
	}

	return diagnostics;
}

class PHSSidebarViewProvider {
	constructor(extensionUri, context, syntaxDiagnostics) {
		this._extensionUri = extensionUri;
		this._context = context;
		this._syntaxDiagnostics = syntaxDiagnostics;
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
									await fs.promises.mkdir(phenotypesDir, { recursive: true });
								await fs.promises.mkdir(sourceOntologiesDir, { recursive: true });
								await fs.promises.mkdir(owlRawDir, { recursive: true });
								await fs.promises.mkdir(path.join(targetDir, "output", "log-shacl"), { recursive: true });
								await fs.promises.mkdir(path.join(targetDir, "output", "log-materializer"), { recursive: true });
								await fs.promises.mkdir(path.join(targetDir, "output", "abox"), { recursive: true });
								await fs.promises.mkdir(path.join(targetDir, "output", "kb"), { recursive: true });

								// Copy only the required template files into phenotypes/
								const templateFiles = ["phs-config.yaml", "example.yphs"];
								for (const file of templateFiles) {
									await fs.promises.copyFile(
										path.join(templateDir, "phenotypes", file),
										path.join(phenotypesDir, file)
									);
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
						const utilsDir = path.join(this._extensionUri.fsPath, 'dir-create', 'main', 'utils');
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
						const toDockerPath = (p) => p.split(path.sep).join('/');

						// On Windows with Git Bash, MSYS path conversion mangles container-side
						// Reuse or create terminal
						if (!this._phenoscriptTerminal || this._phenoscriptTerminal.exitStatus !== undefined) {
							this._phenoscriptTerminal = vscode.window.terminals.find(
								(t) => t.name === 'PhenoScript'
							) || vscode.window.createTerminal({ name: 'PhenoScript', cwd: os.homedir() });
						}
						this._phenoscriptTerminal.show();
						this._phenoscriptTerminal.sendText('clear');
						this._phenoscriptTerminal.sendText('cd "$HOME"');

						// Volume mounts:
						//   /app/input     ← project phenotypes/ (contains .yphs + phs-config.yaml)
						//   /app/snippets  ← extension snippets/ (provides phs-snippets.json)
						//   /app/output    ← project output/owl_init/ (receives .owl + .xml)
						//   /app/nl_output ← project output/nl/ (receives .html / .md)
						//   /app/utils     ← extension dir-create/main/utils/ (contains shacl shapes)
						//   /app/log-shacl ← project output/log-shacl/ (receives shacl logs)
						const dockerCommand =
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

						const launchCmd = await writeDockerLaunchScript(dockerCommand, 'phs-convert-docker');
						this._phenoscriptTerminal.sendText(launchCmd);
						vscode.window.showInformationMessage(`Converting ${fileName} to OWL + natural language (${nlFormat})...`);
					} catch (error) {
						vscode.window.showErrorMessage(`Conversion failed: ${error.message}`);
						console.error(error);
					}
					break;

				case "checkSyntax":
					try {
						const editor = vscode.window.activeTextEditor;
						if (!editor) {
							vscode.window.showErrorMessage('No active editor. Open a .yphs file first.');
							break;
						}
						if (!editor.document.fileName.endsWith('.yphs')) {
							vscode.window.showErrorMessage('Check Syntax only works on .yphs files.');
							break;
						}
						const diagnostics = checkPhsSyntax(editor.document);
						this._syntaxDiagnostics.clear();
						this._syntaxDiagnostics.set(editor.document.uri, diagnostics);

						this._outputChannel.clear();
						this._outputChannel.show(true);
						if (diagnostics.length === 0) {
							this._outputChannel.appendLine('=== Check Syntax: No issues found ===');
						} else {
							this._outputChannel.appendLine(`=== Check Syntax: Found ${diagnostics.length} syntax issue${diagnostics.length > 1 ? 's' : ''} ===`);
							for (const d of diagnostics) {
								this._outputChannel.appendLine(`  Line ${d.range.start.line + 1}: ${editor.document.lineAt(d.range.start.line).text.trim()}`);
							}
							await vscode.commands.executeCommand('workbench.panel.markers.view.focus');
						}
					} catch (error) {
						vscode.window.showErrorMessage(`Syntax check failed: ${error.message}`);
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

						if (!this._phenoscriptTerminal || this._phenoscriptTerminal.exitStatus !== undefined) {
							this._phenoscriptTerminal = vscode.window.terminals.find(
								(t) => t.name === 'PhenoScript'
							) || vscode.window.createTerminal({ name: 'PhenoScript', cwd: os.homedir() });
						}
						this._phenoscriptTerminal.show();
						this._phenoscriptTerminal.sendText('clear');
						this._phenoscriptTerminal.sendText('cd "$HOME"');

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
							'docker run --rm' +
							` -v "${toDockerPath(phenotypesDir)}:/app/input"` +
							` -v "${toDockerPath(sourceOntologiesDir)}:/app/source_ontologies"` +
							` -v "${toDockerPath(tmpOntoScript)}:/app/run.sh"` +
							' --entrypoint /bin/sh' +
							' sergeit215/phenoscript-docker:latest' +
							' /app/run.sh';

						const launchCmd = await writeDockerLaunchScript(ontoDockerCommand, 'phs-get-ontos-docker');
						this._phenoscriptTerminal.sendText(launchCmd);
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
						const utilsDir         = path.join(this._extensionUri.fsPath, 'dir-create', 'main', 'utils');
						const logMaterializerDir = path.join(projectDir, 'output', 'log-materializer');
						const kbDir            = path.join(projectDir, 'output', 'kb');

						// Ensure output dirs exist
						await fs.promises.mkdir(aboxDir, { recursive: true });
						await fs.promises.mkdir(logMaterializerDir, { recursive: true });
						await fs.promises.mkdir(kbDir, { recursive: true });

						const toDockerPath = (p) => p.split(path.sep).join('/');

						if (!this._phenoscriptTerminal || this._phenoscriptTerminal.exitStatus !== undefined) {
							this._phenoscriptTerminal = vscode.window.terminals.find(
								(t) => t.name === 'PhenoScript'
							) || vscode.window.createTerminal({ name: 'PhenoScript', cwd: os.homedir() });
						}
						this._phenoscriptTerminal.show();
						this._phenoscriptTerminal.sendText('clear');
						this._phenoscriptTerminal.sendText('cd "$HOME"');

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

						const launchCmd = await writeDockerLaunchScript(materializeCommand, 'phs-materialize-docker');
						this._phenoscriptTerminal.sendText(launchCmd);
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
