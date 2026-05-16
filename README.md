# VS Code extension for Phenoscript language

 <!-- <p align="left">
  <img src="https://raw.githubusercontent.com/sergeitarasov/vscode-phenoscript/main/icon.png" width="300" title="Phenoscript logo">
</p>  -->

This is an extension for [VS Code](https://code.visualstudio.com) that provides syntax highlight and snippet viewer for [Phenoscript language](https://github.com/sergeitarasov/vscode-phenoscript). It is available for free in the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com). 

Phenoscript is a computer language designed for describing species using ontologies for downstream automatic comparison of their traits. Such analyses can be performed using the Python package [Phenospy available at PyPi repo](https://pypi.org/project/phenospy/). See also [Phenospy GitHub repo](https://github.com/sergeitarasov/PhenoScript). 



## Features
![](https://raw.githubusercontent.com/sergeitarasov/vscode-phenoscript/main/example.png)

## Sidebar Workflow (v0.0.27+)

The sidebar guides you through three sequential steps:

### Step 1 — Write & Convert

With a `.yphs` file open and active in the editor:

- **Convert to OWL + Text** — converts the file to OWL ontology and generates a natural-language description (HTML, Markdown, or both). Runs via Docker.
- **Check Syntax** — validates the active `.yphs` file and reports issues in the Problems panel (no Docker needed).
- **Text file format** — choose HTML, Markdown, or Both for the natural-language output.
- **Add GBIF taxonomy** — enriches the output with GBIF taxonomic data.

### Step 2 — Build Knowledge Base

- **Get / Update Ontologies** — downloads the ontologies declared in `phs-config.yaml` and merges them into `source_ontologies/tbox.owl`. Runs via Docker.
- **Make KB (OWL → KB)** — materialises the ABox, infers axioms using the Whelk reasoner, and produces `output/kb/<project>-kb.ttl`. Runs via Docker.

### Step 3 — Submit *(experimental)*

- **Prepare for Submission (experimental)** — checks SHACL validation logs and consistency, then zips `phenotypes/` into `submit/<project>.zip` ready for repository upload.

---

**Create New Project** — scaffolds a new PhenoScript project with the correct directory structure:
```
my_project/
├── phenotypes/
│   ├── phs-config.yaml   ← fill in your name, ORCID, and project title
│   └── my_species.yphs   ← your phenotype description file
├── source_ontologies/
└── output/
    ├── owl_init/          ← converted OWL files
    ├── nl/                ← natural-language descriptions
    ├── abox/              ← materialised ABox files
    ├── kb/                ← final knowledge base
    └── log-shacl/         ← SHACL validation logs
```

> **Prerequisite:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) must be installed and running for all Docker-based commands. The image `sergeit215/phenoscript-docker` is pulled automatically on first use.

### Tips & Shortcuts

| Feature | How to trigger |
|---|---|
| Term info lookup | Place cursor on term → **⇧⌘E** (Mac) / **Shift+Ctrl+E** (Win/Linux), or right-click → *PHS: Show term info* |
| YPHS → PHS preview | Right-click a `.yphs` file → *YPHS → PHS (preview)* |
| Browse with Sparklis | Right-click a `.ttl` or `.owl` file → *Browse with Sparklis* |


## Project Setup & OWL Conversion (v0.0.24+)

The extension sidebar provides two commands:

**Create Project** — scaffolds a new PhenoScript project with the correct directory structure:
```
my_project/
├── phenotypes/
│   ├── phs-config.yaml   ← fill in your name, ORCID, and project title
│   └── my_species.yphs   ← your phenotype description file
├── source_ontologies/
└── output/
    └── owl_init/         ← converted OWL files appear here
```

**Convert to OWL** — converts the active `.phs` or `.yphs` file to OWL ontology (`.owl` + `.xml`) using the [phenoscript-docker](https://hub.docker.com/r/sergeit215/phenoscript-docker) image.

> **Prerequisite:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) must be installed and running. The Docker image is pulled automatically on first use — no manual setup required.
<!-- > Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow. -->


## Documentation

See [Wiki for details](https://github.com/sergeitarasov/PhenoScript/wiki).

## Funding
This project is supported by the [Academy of Finland](https://www.aka.fi/en/) grants 339576 and 346294.

## Installing

Install [VS Code](https://code.visualstudio.com) and launch it. Install the Phenoscript extension from the Visual Studio Code Marketplace by clicking on "Extensions" on the left hand side bar.

## Usage

To activate the ontology term info lookup feature, follow these steps:

- Place your cursor on the focal term.
- Use the following hotkeys based on your platform:
    - Windows: "Ctrl+Shift+E"
    - macOS: "Cmd+Shift+E"

This will provide you with information about the ontology term you have selected.


<!-- ## Extension Settings
Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `phs.enable`: Enable/disable this extension.
* `phs.thing`: Set to `blah` to do something. -->

## Recommended Packages

To enhance your experience with PhenoScript, we recommend installing and using the following packages. For more information, please visit the [Wiki](https://github.com/sergeitarasov/PhenoScript/wiki/Configure-Phenoscript-VS-Code).

- [Highlight IceMode Extension](https://marketplace.visualstudio.com/items?itemName=iceliu.highlight-icemode)
- [Highlight Package](https://marketplace.visualstudio.com/items?itemName=fabiospampinato.vscode-highlight)


## Known Issues

n/a

## Release Notes
This is the first release that is currently in the testing phase.

### 0.0.11
Syntax highlight, dark theme, snippets.


### 0.0.19

- Ontology Term info Lookup via Webview.
- Smart syntax error highlighting. When quality terms are linked using 'has_part' or 'part_of,' the statements are displayed with red highlighting.
- Integration with [Highlight package](https://marketplace.visualstudio.com/items?itemName=fabiospampinato.vscode-highlight): three types of colorful comments and bounding boxes for color terms. 

### 0.0.20

- README update

### 0.0.21/0.0.22

- Improved highlight of erroneous syntax

### 0.0.23

- Snippets are added for markdown to insert ontology terms. Click ctrl+space if the snippets do not appear automatically.

<!-- ### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z. -->

<!-- ---

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets. -->

<!-- ## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/) -->


## Credits

The theme is based on [One Dark Teme](https://github.com/akamud/vscode-theme-onedark).
