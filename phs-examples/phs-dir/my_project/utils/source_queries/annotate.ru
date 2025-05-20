PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
INSERT {
  [] rdf:type owl:Axiom ;
     owl:annotatedSource ?s ;
     owl:annotatedProperty ?p ;
     owl:annotatedTarget ?o ;
     rdfs:comment "inferred" .
}
WHERE {
  ?s ?p ?o .
}