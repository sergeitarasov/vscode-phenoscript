const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

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
}

function deactivate() { }

module.exports = {
	activate,
	deactivate,
};
