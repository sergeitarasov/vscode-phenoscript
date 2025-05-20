PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX ex: <http://example.org/>
PREFIX obo: <http://purl.obolibrary.org/obo/>
PREFIX phs: <https://github.com/sergeitarasov/PhenoScript/>

# update --data output/scarabaeus.owl --update utils/source_queries/insert.ru --dump > output/inserted.ttl

# Combined query that inserts and deletes

DELETE {
  ?Y ?a ?b .
  ?b2 ?a2 ?Y .
  ?axiom rdf:type owl:Axiom .
  ?axiom owl:annotatedSource ?s .
  ?axiom owl:annotatedProperty ?p .
  ?axiom owl:annotatedTarget ?Y .
  ?axiom phs:PHS_0000005 true .
}
INSERT {
  _:restriction rdf:type owl:Restriction ;
                owl:onProperty obo:RO_HOM0000001 ;
                owl:someValuesFrom ?Y_Class .
  ?X rdf:type _:restriction .
}
WHERE {
  ?X obo:RO_HOM0000001 ?Y .
  ?Y rdf:type ?Y_Class .
  
  OPTIONAL { ?Y ?a ?b . }
  OPTIONAL { ?b2 ?a2 ?Y  . }
  OPTIONAL {
    ?axiom rdf:type owl:Axiom .
    ?axiom owl:annotatedSource ?s .
    ?axiom owl:annotatedProperty ?p .
    ?axiom owl:annotatedTarget ?Y .
    ?axiom phs:PHS_0000005 true .
  }
}


# Separate queries forminsertion and deletion

# INSERT {
#   _:restriction rdf:type owl:Restriction ;
#                 owl:onProperty obo:RO_HOM0000001 ;
#                 owl:someValuesFrom ?Y_Class .
#   ?X rdf:type _:restriction .
# }
# WHERE {
#   ?Y rdf:type ?Y_Class .
#   #?X rdf:type owl:NamedIndividual .
#   ?X obo:RO_HOM0000001 ?Y .
# }



# DELETE {
#   ?Y ?a ?b .
#   ?b2 ?a2 ?Y .
#   ?axiom rdf:type owl:Axiom .
#   ?axiom owl:annotatedSource ?s .
#   ?axiom owl:annotatedProperty ?p .
#   ?axiom owl:annotatedTarget ?Y .
#   ?axiom phs:PHS_0000005 true .
# }
# WHERE {
#   ?s obo:RO_HOM0000001 ?Y .
#   OPTIONAL { ?Y ?a ?b . }
#   OPTIONAL { ?b2 ?a2 ?Y  . }
#   OPTIONAL {?axiom rdf:type owl:Axiom .}
  
#   # ?axiom owl:annotatedSource ?s .
#   # ?axiom owl:annotatedProperty ?p .
#   # ?axiom owl:annotatedTarget ?o .
#   # ?axiom phs:PHS_0000005 true .
# }

