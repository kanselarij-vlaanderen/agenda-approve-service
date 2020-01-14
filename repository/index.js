import mu from 'mu';
const moment = require('moment');
const uuidv4 = require('uuid/v4');
const targetGraph = "http://mu.semte.ch/graphs/organizations/kanselarij";

const createNewAgenda = async (req, res, oldAgendaURI) => {
    const newUUID = uuidv4();
    const reqTime = moment();
    const reqTimeFormatted = reqTime.format('YYYY-MM-DD');
    const agendaName = req.body.agendaName;
    const session = req.body.createdFor;
    const query = `
PREFIX adms: <http://www.w3.org/ns/adms#>
PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
PREFIX agenda: <http://kanselarij.vo.data.gift/id/agendas/>
PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

INSERT DATA {
  GRAPH <${targetGraph}> { 
  agenda:${newUUID} a besluitvorming:Agenda ;
  ext:aangemaaktOp "${reqTimeFormatted}" ;
  mu:uuid "${newUUID}" ;
  besluit:isAangemaaktVoor <http://kanselarij.vo.data.gift/id/zittingen/${session}> ;
  ext:agendaNaam "${agendaName}" ;
  ext:accepted "false"^^<http://mu.semte.ch/vocabularies/typed-literals/boolean> .
  <${oldAgendaURI}> besluitvorming:heeftVorigeVersie agenda:${newUUID};
}
}`;
    await mu.query(query).catch(err => {
        console.error(err)
    });
    return [newUUID, "http://kanselarij.vo.data.gift/id/agendas/" + newUUID];
};

const getSubcasePhaseCode = async () => {
    const query = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  
  SELECT ?code WHERE {
    GRAPH <${targetGraph}> {
          ?code a ext:ProcedurestapFaseCode ;
                  skos:prefLabel ?label .
                   FILTER(UCASE(?label) = UCASE("geagendeerd"))  
    }
  }
`;
    const data = await mu.query(query).catch(err => {
        console.error(err)
    });
    console.log(data);
    return data.results.bindings[0].code.value;
};

const getSubcasePhasesOfAgenda = async (newAgendaId, codeURI) => {
    const query = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  
  SELECT ?agenda ?agendaitem ?subcase ?phases WHERE {
    GRAPH <${targetGraph}> {
        ?agenda a besluitvorming:Agenda ;
                  mu:uuid "${newAgendaId}" .
        ?agenda   dct:hasPart ?agendaitem .
        ?subcase  besluitvorming:isGeagendeerdVia ?agendaitem .
        OPTIONAL{ 
                  ?subcase ext:subcaseProcedurestapFase ?phases . 
                  ?phases  ext:procedurestapFaseCode <${codeURI}> . 
                }   
    }
  }
`;
    return await mu.query(query).catch(err => {
        console.error(err)
    });
};

const markAgendaItemsPartOfAgendaA = async (agendaUri) => {
    const query = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  
  INSERT {
    GRAPH <${targetGraph}> {
      ?agendaItem ext:partOfFirstAgenda """true"""^^<http://mu.semte.ch/vocabularies/typed-literals/boolean> .
    }
  } WHERE {
    <${agendaUri}> dct:hasPart ?agendaItem .
    
    FILTER NOT EXISTS {
      <${agendaUri}> besluitvorming:heeftVorigeVersie ?o.
    }      
  }`;
    return await mu.query(query).catch(err => {
        console.error(err)
    });
};

const storeAgendaItemNumbers = async (agendaUri) => {
    const maxAgendaItemNumberSoFar = await getHighestAgendaItemNumber(agendaUri);
    let query = `PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  
  SELECT ?agendaItem WHERE {
    <${agendaUri}> dct:hasPart ?agendaItem .
    OPTIONAL {
      ?agendaItem ext:prioriteit ?priority .
    }
    BIND(IF(BOUND(?priority), ?priority, 1000000) AS ?priorityOrMax)
    FILTER NOT EXISTS {
      ?agendaItem ext:agendaItemNumber ?number .
    }
  } ORDER BY ?priorityOrMax`;
    const sortedAgendaItemsToName = await mu.query(query).catch(err => {
        console.error(err)
    });
    const triples = [];
    sortedAgendaItemsToName.results.bindings.map((binding, index) => {
        triples.push(`<${binding['agendaItem'].value}> ext:agendaItemNumber ${maxAgendaItemNumberSoFar + index} .`);
    });

    if (triples.length < 1) {
        return;
    }

    query = `PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  
  INSERT DATA {
    GRAPH <${targetGraph}> {
      ${triples.join("\n")}
    }
  }`;
    await mu.query(query).catch(err => {
        console.log(err);
    })
};

const getHighestAgendaItemNumber = async (agendaUri) => {
    const query = `PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  
  SELECT (MAX(?number) as ?max) WHERE {
      <${agendaUri}> besluit:isAangemaaktVoor ?zitting .
      ?zitting besluit:geplandeStart ?zittingDate .
      ?otherZitting besluit:geplandeStart ?otherZittingDate .
      FILTER(YEAR(?zittingDate) = YEAR(?otherZittingDate))
      ?otherAgenda besluit:isAangemaaktVoor ?otherZitting .
      ?otherAgenda dct:hasPart ?agendaItem .
      ?agendaItem ext:agendaItemNumber ?number .
  }`;
    const response = await mu.query(query);
    return parseInt(((response.results.bindings[0] || {})['max'] || {}).value || 0);
};

const getUnnamedDocumentsOfAgenda = async (agendaUri) => {
    const query = `PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  
  SELECT ?agendaItem ?existingNumbers ?document ?number ?zittingDate ?dossierType ?announcement WHERE {
    <${agendaUri}> besluit:isAangemaaktVoor ?zitting .
    ?zitting besluit:geplandeStart ?zittingDate .
    <${agendaUri}> dct:hasPart ?agendaItem .
    ?agendaItem ext:bevatAgendapuntDocumentversie ?documentVersion .
    ?document besluitvorming:heeftVersie ?documentVersion .
    ?agendaItem ext:agendaItemNumber ?number .

    FILTER NOT EXISTS {
      ?document besluitvorming:stuknummerVR ?vrnumber .
    }

    OPTIONAL {
      ?agendaItem ext:wordtGetoondAlsMededeling ?announcement .
    }
    OPTIONAL { 
      ?subcase besluitvorming:isGeagendeerdVia ?agendaItem .
      OPTIONAL {
        ?case dct:hasPart ?subcase .
        ?case dct:type ?dossierType .
      }
    }
    OPTIONAL {
      ?document ext:documentType ?docType .
      ?docType ext:prioriteit ?prio .
    }
    BIND(IF(BOUND(?prio), ?prio, 1000000) AS ?documentPriority)

    { SELECT ?agendaItem (COUNT(DISTINCT(?othervrnumber)) AS ?existingNumbers) WHERE {
        ?agendaItem ext:bevatAgendapuntDocumentversie ?otherVersion .
        ?otherDocument besluitvorming:heeftVersie ?otherVersion .
        OPTIONAL { ?otherDocument besluitvorming:stuknummerVR ?othervrnumber . }
    } GROUP BY ?agendaItem }
    
  } ORDER BY ?agendaItem ?documentPriority
  `;

    return await mu.query(query).catch(err => {
        console.error(err)
    });
};
const createNewSubcasesPhase = async (codeURI, subcaseListOfURIS) => {
    if (subcaseListOfURIS.length < 1) {
        return;
    }
    const listOfQueries = await subcaseListOfURIS.map((subcaseURI) => {
        const newUUID = uuidv4();
        const newURI = `http://data.vlaanderen.be/id/ProcedurestapFase/${newUUID}`;
        return `
    <${newURI}> a   ext:ProcedurestapFase ;
    mu:uuid "${newUUID}" ;
    besluitvorming:statusdatum """${new Date().toISOString()}"""^^xsd:dateTime ;
    ext:procedurestapFaseCode <${codeURI}> .
    <${subcaseURI}> ext:subcaseProcedurestapFase <${newURI}> .
    `
    });

    if (listOfQueries.length < 1) {
        return;
    }

    const insertString = listOfQueries.join(' ');
    console.log(insertString);
    const query = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    
  INSERT DATA {
   GRAPH <${targetGraph}> {
          ${insertString}
   }
  };
`;
    return await mu.update(query).catch(err => {
        console.error(err)
    });
};

const getAgendaURI = async (newAgendaId) => {
    const query = `
   PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
   PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
   PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

   SELECT ?agenda WHERE {
    ?agenda a besluitvorming:Agenda ;
    mu:uuid "${newAgendaId}" .
   }
 `;

    const data = await mu.query(query).catch(err => {
        console.error(err)
    });
    return data.results.bindings[0].agenda.value;
};


module.exports = {
    createNewAgenda,
    getSubcasePhaseCode,
    getSubcasePhasesOfAgenda,
    markAgendaItemsPartOfAgendaA,
    storeAgendaItemNumbers,
    getUnnamedDocumentsOfAgenda,
    createNewSubcasesPhase,
    getAgendaURI
};

