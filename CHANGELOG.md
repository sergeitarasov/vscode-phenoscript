# Change Log

All notable changes to the "phenoscript" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release



## [0.0.19] - 2023-10-27

### Added

- Ontology Term info lookup via Webview. Use hotkeys: Win "ctrl+shift+e", Mac "cmd+shift+e".
- Smart syntax error highlighting. When quality terms are linked using 'has_part' or 'part_of,' the statements are displayed with red highlighting.
- Integration with [Highlight package](https://marketplace.visualstudio.com/items?itemName=fabiospampinato.vscode-highlight): three types of colorful comments and bounding boxes for color terms. 
- Snippets updated.


## [0.0.20] - 2023-10-27

### Added

- README update


## [0.0.24] - 2026-03-27

### Added

- **Create Project** command: creates a ready-to-use PhenoScript project structure (`phenotypes/`, `source_ontologies/`, `output/owl_init/`) with template files (`phs-config.yaml`, `my_species.yphs`).
- After project creation, the Explorer sidebar opens automatically and `phs-config.yaml` is shown with a prompt to fill in author name, ORCID ID, and project title.
- **Convert to OWL** command: converts the active `.phs` or `.yphs` file to OWL ontology (`.owl` + `.xml`) via Docker. Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).
- Docker image `sergeit215/phenoscript-docker` is pulled automatically on first use — no manual setup required.
- Cross-platform support: Windows (PowerShell and Git Bash), macOS, and Linux.


## [0.0.26] - 2026-05-15

### Added

- new snippets and yaml templates.