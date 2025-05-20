# Define variables
PHS_FILE = scarabaeus_madagascar.phs
OUT_FILE_OWL = scarabaeus
CONFIG_FILE = phenotypes/phs-config.yaml


# Default target
all: phs2-owl-NL validate-phs make-tbox reason-owl



# Convert phs To OWL & NL 
phs2-owl-NL:
	@echo "\nSTEP: phs TO OWL";
	cd phenotypes && phenospy phs2owl $(PHS_FILE) ../output/$(OUT_FILE_OWL)
	cd ..;
	@echo "\nSTEP: phs TO NL";
	phenospy owl2text -f 'html' -s 'org_*' -o output/$(OUT_FILE_OWL).owl -d output/NL
	phenospy owl2text -f 'md' -s 'org_*' -o output/$(OUT_FILE_OWL).owl -d output/NL

# Validate phs using SHACL
validate-phs:
	@echo "\nSTEP: Validate using SHACL";
	@mkdir -p log;
	shacl validate --data output/$(OUT_FILE_OWL).owl --shapes utils/source_queries/phenoscript.shacl.ttl > log/shacl.log


# Make Tbox ontology file: 
# donwload source ontologies, merge them, remove individuals
# also adds source_queries/query.rdf that contains precooked classes for queries
make-tbox:
	@echo "\nSTEP: make Tbox file";
	@if [ ! -d "source_ontologies" ] || [ -z "$$(ls source_ontologies 2>/dev/null)" ]; then \
		echo "Current directory: $$(pwd)"; \
		echo "Downloading source_ontologies ..."; \
		phenospy fetch-ontos $(CONFIG_FILE) source_ontologies; \
		echo "robot merge ontologies ..."; \
		robot merge --inputs "source_ontologies/*.owl" --input utils/source_queries/query.ttl --output source_ontologies/tbox.owl; \
		echo "robot remove individuals ..."; \
		robot remove --input source_ontologies/tbox.owl --select individuals --output source_ontologies/tbox.owl; \
	else \
		echo "source_ontologies is not empty. Skipping update."; \
	fi

# resaon Abox using Tbox file with materializer
# annotate inffered axioms
# merge all ontologies into a single file
reason-owl:
	@echo "\nSTEP: reason using materializer";
	materializer file --ontology-file source_ontologies/tbox.owl --input output/$(OUT_FILE_OWL).owl --output output/$(OUT_FILE_OWL)-reasoned_raw.ttl --reasoner whelk > log/materializer.log
	@echo "\nSTEP: annotate inffered axioms";
	update --data output/$(OUT_FILE_OWL)-reasoned_raw.ttl --update utils/source_queries/annotate.ru --dump > output/$(OUT_FILE_OWL)-reasoned-annotated.ttl
	@echo "\nSTEP: merge all ontologies into a single file";
	riot output/$(OUT_FILE_OWL).owl output/$(OUT_FILE_OWL)-reasoned-annotated.ttl source_ontologies/tbox.owl > output/$(OUT_FILE_OWL)-final.ttl
	@echo "\nMAKE COMPLETED";