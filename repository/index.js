import mu from 'mu';
import {
  sparqlEscapeUri,
  sparqlEscapeString,
  uuid as generateUuid,
  sparqlEscapeDate,
  sparqlEscapeDateTime,
  sparqlEscapeInt
} from 'mu';
const moment = require('moment');
const targetGraph = "http://mu.semte.ch/application";

const AGENDA_RESOURCE_BASE = 'http://kanselarij.vo.data.gift/id/agendas/';
const AGENDA_STATUS_DESIGN = 'http://kanselarij.vo.data.gift/id/agendastatus/2735d084-63d1-499f-86f4-9b69eb33727f';
const AGENDA_STATUS_APPROVED = 'http://kanselarij.vo.data.gift/id/agendastatus/ff0539e6-3e63-450b-a9b7-cc6463a0d3d1';

const SUBCASE_PHASE_RESOURCE_BASE = 'http://data.vlaanderen.be/id/ProcedurestapFase/';

const createNewAgenda = async (req, res, oldAgendaURI) => {
  const newAgendaUuid = generateUuid();
  const newAgendaUri = AGENDA_RESOURCE_BASE + newAgendaUuid;
  const creationDate = new Date();
  const session = req.body.createdFor;
  const serialNumbers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const { sessionUri, agendaCount, zittingDate } = await zittingInfo(session);
  const serialNumber = serialNumbers[agendaCount] || agendaCount;
  const title = `Agenda ${serialNumber} voor zitting ${moment(zittingDate).format('D-M-YYYY')}`;
  const query = `
PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX dct: <http://purl.org/dc/terms/>

INSERT DATA {
    GRAPH <${targetGraph}> { 
        ${sparqlEscapeUri(newAgendaUri)} a besluitvorming:Agenda ;
            mu:uuid ${sparqlEscapeString(newAgendaUuid)} ;
            dct:created ${sparqlEscapeDate(creationDate)} ;
            dct:modified ${sparqlEscapeDateTime(creationDate)} ;
            dct:title ${sparqlEscapeString(title)} ;
            besluitvorming:agendaStatus ${sparqlEscapeUri(AGENDA_STATUS_DESIGN)} ;
            besluitvorming:isAgendaVoor ${sparqlEscapeUri(sessionUri)} ;
            besluitvorming:volgnummer ${sparqlEscapeString(serialNumber)} ;
            prov:wasRevisionOf ${sparqlEscapeUri(oldAgendaURI)}  .
    }
}`;
  await mu.query(query).catch(err => {
    console.error(err);
  });
  return [newAgendaUuid, newAgendaUri];
};

const approveAgenda = async (agendaURI) => {
  const query = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  DELETE DATA {
    GRAPH <${targetGraph}> {
      ${sparqlEscapeUri(agendaURI)} besluitvorming:agendaStatus ${sparqlEscapeUri(AGENDA_STATUS_DESIGN)} .
    }
  };
  INSERT DATA {
    GRAPH <${targetGraph}> {
      ${sparqlEscapeUri(agendaURI)} besluitvorming:agendaStatus ${sparqlEscapeUri(AGENDA_STATUS_APPROVED)} .
    }
  }`;
  await mu.query(query);
};

const zittingInfo = async (zittingUuid) => {
  const query = `
PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

SELECT ?zitting ?zittingDate (COUNT(DISTINCT(?agenda)) AS ?agendacount) WHERE {
    ?zitting a besluit:Vergaderactiviteit ;
        besluit:geplandeStart ?zittingDate ;
        mu:uuid ${sparqlEscapeString(zittingUuid)} .
    ?agenda besluitvorming:isAgendaVoor ?zitting .
}
GROUP BY ?zitting ?zittingDate`;
  const data = await mu.query(query).catch(err => {
    console.error(err);
  });
  const firstResult = data.results.bindings[0] || {};
  return {
    sessionUri: firstResult.zitting.value,
    zittingDate: firstResult.zittingDate.value,
    agendaCount: parseInt(firstResult.agendacount.value)
  };
};

const getSubcasePhasesOfAgenda = async (newAgendaId, codeURI) => {
  const query = `
PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
PREFIX dct: <http://purl.org/dc/terms/>

SELECT ?agenda ?agendaitem ?subcase ?phases WHERE {
    GRAPH <${targetGraph}> {
        ?agenda a besluitvorming:Agenda ;
            mu:uuid ${sparqlEscapeString(newAgendaId)} ;
            dct:hasPart ?agendaitem .
        ?subcase besluitvorming:isGeagendeerdVia ?agendaitem .
        OPTIONAL {
            ?subcase ext:subcaseProcedurestapFase ?phases . 
            ?phases ext:procedurestapFaseCode ${sparqlEscapeUri(codeURI)} . 
        }   
    }
}
`;
  return await mu.query(query).catch(err => {
    console.error(err);
  });
};

const storeAgendaItemNumbers = async (agendaUri) => {
  const maxAgendaItemNumberSoFar = await getHighestAgendaItemNumber(agendaUri);
  let query = `
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

SELECT ?agendaItem WHERE {
    ${sparqlEscapeUri(agendaUri)} dct:hasPart ?agendaItem .
    OPTIONAL {
        ?agendaItem ext:prioriteit ?priority .
    }
    BIND(IF(BOUND(?priority), ?priority, 1000000) AS ?priorityOrMax)
    FILTER NOT EXISTS {
        ?agendaItem ext:agendaItemNumber ?number .
    }
}
ORDER BY ?priorityOrMax`;
  const sortedAgendaItemsToName = await mu.query(query).catch(err => {
    console.error(err);
  });

  const triples = [];
  sortedAgendaItemsToName.results.bindings.map((binding, index) => {
    triples.push(`${sparqlEscapeUri(binding.agendaItem.value)} ext:agendaItemNumber ${sparqlEscapeInt(maxAgendaItemNumberSoFar + index)} .`);
  });
  if (triples.length < 1) {
    return;
  }
  query = `
PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

INSERT DATA {
    GRAPH <${targetGraph}> {
        ${triples.join('\n        ')}
    }
}`;
  await mu.update(query).catch(err => {
    console.log(err);
  });
};

const getHighestAgendaItemNumber = async (agendaUri) => {
  // TODO: This query seems needlessly complex. Why the "otherzitting" and comparing by year?
  const query = `
PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

SELECT (MAX(?number) as ?max) WHERE {
    ${sparqlEscapeUri(agendaUri)} besluitvorming:isAgendaVoor ?zitting .
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
    const newUUID = generateUuid();
    const newURI = SUBCASE_PHASE_RESOURCE_BASE + newUUID;
    return `
${sparqlEscapeUri(newURI)} a ext:ProcedurestapFase ;
      mu:uuid ${sparqlEscapeString(newUUID)} ;
      besluitvorming:statusdatum ${sparqlEscapeDateTime(new Date())} ;
      ext:procedurestapFaseCode ${sparqlEscapeUri(codeURI)} .
${sparqlEscapeUri(subcaseURI)} ext:subcaseProcedurestapFase ${sparqlEscapeUri(newURI)} .
    `;
  });

  if (listOfQueries.length < 1) {
    return;
  }

  const insertString = listOfQueries.join('\n        ');
  console.log(insertString);
  const query = `
PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  
INSERT DATA {
    GRAPH <${targetGraph}> {
        ${insertString}
    }
};
`;
  return await mu.update(query).catch(err => {
    console.error(err);
  });
};

const getAgendaURI = async (newAgendaId) => {
  const query = `
   PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
   PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

   SELECT ?agenda WHERE {
    ?agenda a besluitvorming:Agenda ;
      mu:uuid ${sparqlEscapeString(newAgendaId)} .
   }
 `;

  const data = await mu.query(query).catch(err => {
    console.error(err);
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
    ${sparqlEscapeUri(deleteAgendaURI)} dct:hasPart ?agendaitem .
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
            ${sparqlEscapeUri(deleteAgendaURI)} dct:hasPart ?agendaitems .

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
    ${sparqlEscapeUri(deleteAgendaURI)} ?p ?o .
    ?s ?pp ${sparqlEscapeUri(deleteAgendaURI)} .
  }
  } WHERE {
    GRAPH <${targetGraph}> { 
    ${sparqlEscapeUri(deleteAgendaURI)} a besluitvorming:Agenda ;
      ?p ?o .
      OPTIONAL {
        ?s ?pp ${sparqlEscapeUri(deleteAgendaURI)} .
      }
    }
  }`;
  await mu.query(query);
};

module.exports = {
  createNewAgenda,
  getSubcasePhasesOfAgenda,
  storeAgendaItemNumbers,
  createNewSubcasesPhase,
  getAgendaURI,
  deleteSubcasePhases,
  deleteAgendaitems,
  deleteAgenda,
  approveAgenda
};
