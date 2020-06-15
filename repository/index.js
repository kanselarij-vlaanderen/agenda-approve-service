import mu from 'mu';
const moment = require('moment');
const uuidv4 = require('uuid/v4');
const targetGraph = "http://mu.semte.ch/application";

const createNewAgenda = async (req, res, oldAgendaURI) => {
  const newUUID = uuidv4();
  const reqDate = moment();
  const reqDateFormatted = reqDate.format('YYYY-MM-DD');
  const reqDateTimeFormatted = reqDate.utc().format();
  const session = req.body.createdFor;
  const serialNumbers = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const {sessionUri, agendaCount, zittingDate} = await zittingInfo(session);
  const serialNumber = serialNumbers[agendaCount] || agendaCount;
  const query = `
PREFIX adms: <http://www.w3.org/ns/adms#>
PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
PREFIX agenda: <http://kanselarij.vo.data.gift/id/agendas/>
PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX statusid: <http://kanselarij.vo.data.gift/id/agendastatus/>

INSERT DATA {
  GRAPH <${targetGraph}> { 
    agenda:${newUUID} a besluitvorming:Agenda ;
    dct:created "${reqDateFormatted}" ;
    dct:modified "${reqDateTimeFormatted}" ;
    besluitvorming:agendaStatus statusid:2735d084-63d1-499f-86f4-9b69eb33727f ;
    mu:uuid "${newUUID}" ;
    besluitvorming:isAgendaVoor <${sessionUri}> ;
    dct:title "Agenda ${serialNumber} voor zitting ${moment(zittingDate).format('D-M-YYYY')}" ;
    besluitvorming:volgnummer "${serialNumber}" ;
    ext:accepted "false"^^<http://mu.semte.ch/vocabularies/typed-literals/boolean> .
    agenda:${newUUID} prov:wasRevisionOf <${oldAgendaURI}>  .
  }
}`;
  await mu.query(query).catch(err => {
    console.error(err)
  });
  return [newUUID, "http://kanselarij.vo.data.gift/id/agendas/" + newUUID];
};

const approveAgenda = async (agendaURI) => {
  const query = `DELETE DATA {
    GRAPH <${targetGraph}> {
      <${agendaURI}> <http://data.vlaanderen.be/ns/besluitvorming#agendaStatus> <http://kanselarij.vo.data.gift/id/agendastatus/2735d084-63d1-499f-86f4-9b69eb33727f> .
    }
  };
  INSERT DATA {
    GRAPH <${targetGraph}> {
      <${agendaURI}> <http://data.vlaanderen.be/ns/besluitvorming#agendaStatus> <http://kanselarij.vo.data.gift/id/agendastatus/ff0539e6-3e63-450b-a9b7-cc6463a0d3d1> .
    }
  }`;
  await mu.query(query);
};

const zittingInfo = async (zittingUuid) => {
  const query = `
PREFIX adms: <http://www.w3.org/ns/adms#>
PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
PREFIX agenda: <http://kanselarij.vo.data.gift/id/agendas/>
PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX statusid: <http://kanselarij.vo.data.gift/id/agendastatus/>

SELECT ?zitting ?zittingDate (COUNT(DISTINCT(?agenda)) AS ?agendacount) WHERE {
  ?zitting a besluit:Vergaderactiviteit ;
           besluit:geplandeStart ?zittingDate ;
           mu:uuid "${zittingUuid}" .
  ?agenda besluitvorming:isAgendaVoor ?zitting .
} GROUP BY ?zitting ?zittingDate`;
  const data = await mu.query(query).catch(err => {
    console.error(err)
  });
  const firstResult = data.results.bindings[0] || {};
  return {
    sessionUri: firstResult.zitting.value,
    zittingDate: firstResult.zittingDate.value,
    agendaCount: parseInt(firstResult.agendacount.value)
  };
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
      <${agendaUri}> besluitvorming:isAgendaVoor ?zitting .
      ?zitting besluit:geplandeStart ?zittingDate .
      ?otherZitting besluit:geplandeStart ?otherZittingDate .
      FILTER(YEAR(?zittingDate) = YEAR(?otherZittingDate))
      ?otherAgenda besluitvorming:isAgendaVoor ?otherZitting .
      ?otherAgenda dct:hasPart ?agendaItem .
      ?agendaItem ext:agendaItemNumber ?number .
  }`;
  const response = await mu.query(query);
  return parseInt(((response.results.bindings[0] || {})['max'] || {}).value || 0);
};

const createNewSubcasesPhase = async (codeURI, subcaseListOfURIS) => {
  if (subcaseListOfURIS.length < 1) {
    return;
  }
  const listOfQueries = await subcaseListOfURIS.map((subcaseURI) => {
    const newUUID = uuidv4();
    const newURI = `http://data.vlaanderen.be/id/ProcedurestapFase/${newUUID}`;
    return `
    <${newURI}> a ext:ProcedurestapFase ;
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

const deleteAgendaitems = async (deleteAgendaURI) => {
  const query = `
  PREFIX dct: <http://purl.org/dc/terms/>

  DELETE {
    GRAPH <${targetGraph}>  {
    ?agendaitem ?p ?o .
    ?s ?pp ?agendaitem .
  }
  } WHERE {
    GRAPH <${targetGraph}> { 
    <${deleteAgendaURI}> dct:hasPart ?agendaitem .
      ?agendaitem ?p ?o .
      ?s ?pp ?agendaitem .
    }
  }`;
  await mu.query(query);
};

const deleteSubcasePhases = async (deleteAgendaURI) => {
  const query = `
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>

  DELETE {
    GRAPH <${targetGraph}> {

    ?subcase besluitvorming:isAangevraagdVoor ?session .
    ?subcase ext:subcaseProcedurestapFase ?phase .
    ?phase ?p ?o .
    ?subcase besluitvorming:isGeagendeerdVia ?agendapunt .
    }
  }
  
 WHERE {
    GRAPH <${targetGraph}> {

    ?subcase a dbpedia:UnitOfWork .
    OPTIONAL { ?subcase besluitvorming:isAangevraagdVoor ?session .}
    OPTIONAL { ?subcase ext:subcaseProcedurestapFase ?phase .
      OPTIONAL { ?phase ?p ?o . }
      }
    OPTIONAL { ?subcase besluitvorming:isGeagendeerdVia ?agendapunt . }
    
      FILTER (?totalitems = 1)  {

        SELECT (count(*) AS ?totalitems) ?subcase WHERE {
          GRAPH <${targetGraph}> {
            <${deleteAgendaURI}> dct:hasPart ?agendaitems .

            ?subcase a dbpedia:UnitOfWork . 
            ?subcase besluitvorming:isGeagendeerdVia ?agendaitems .
            ?subcase besluitvorming:isGeagendeerdVia ?totalitems .
          }
        }
        GROUP BY ?subcase
      }
       
    }
  }
  `;
  await mu.query(query);
};

const deleteAgenda = async (deleteAgendaURI) => {
  const query = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>

  DELETE {
    GRAPH <${targetGraph}>  {
    <${deleteAgendaURI}> ?p ?o .
    ?s ?pp <${deleteAgendaURI}> .
  }
  } WHERE {
    GRAPH <${targetGraph}> { 
    <${deleteAgendaURI}> a besluitvorming:Agenda ;
      ?p ?o .
      OPTIONAL {
        ?s ?pp <${deleteAgendaURI}> .
      }
    }
  }`;
  await mu.query(query);
};

module.exports = {
  createNewAgenda,
  getSubcasePhaseCode,
  getSubcasePhasesOfAgenda,
  storeAgendaItemNumbers,
  createNewSubcasesPhase,
  getAgendaURI,
  deleteSubcasePhases,
  deleteAgendaitems,
  deleteAgenda,
  approveAgenda
};

