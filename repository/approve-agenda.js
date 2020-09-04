import mu, {
  sparqlEscapeDateTime,
  sparqlEscapeInt,
  sparqlEscapeString,
  sparqlEscapeUri,
  uuid as generateUuid
} from 'mu';
import moment from 'moment';
import { selectAgendaItems } from './agenda-general';

const targetGraph = 'http://mu.semte.ch/application';
const batchSize = process.env.BATCH_SIZE || 100;

const AGENDA_RESOURCE_BASE = 'http://kanselarij.vo.data.gift/id/agendas/';
const AGENDA_ITEM_RESOURCE_BASE = 'http://kanselarij.vo.data.gift/id/agendapunten/';
const AGENDA_STATUS_DESIGN = 'http://kanselarij.vo.data.gift/id/agendastatus/2735d084-63d1-499f-86f4-9b69eb33727f';
const AGENDA_STATUS_APPROVED = 'http://kanselarij.vo.data.gift/id/agendastatus/ff0539e6-3e63-450b-a9b7-cc6463a0d3d1';

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
            dct:created ${sparqlEscapeDateTime(creationDate)} ;
            dct:modified ${sparqlEscapeDateTime(creationDate)} ;
            dct:title ${sparqlEscapeString(title)} ;
            besluitvorming:agendaStatus ${sparqlEscapeUri(AGENDA_STATUS_DESIGN)} ;
            besluitvorming:isAgendaVoor ${sparqlEscapeUri(sessionUri)} ;
            besluitvorming:volgnummer ${sparqlEscapeString(serialNumber)} ;
            prov:wasRevisionOf ${sparqlEscapeUri(oldAgendaURI)}  .
    }
}`;
  await mu.update(query).catch(err => {
    console.error(err);
  });
  return [newAgendaUuid, newAgendaUri];
};

// TODO: This query can be handled by a resource api-call. Refactor out.
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
  await mu.update(query);
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
  return parseInt(((response.results.bindings[0] || {}).max || {}).value || 0);
};

const updatePropertiesOnAgendaItems = async function (agendaUri) {
  const selectTargets = `
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX dct: <http://purl.org/dc/terms/>

SELECT DISTINCT ?target WHERE {
    ${sparqlEscapeUri(agendaUri)} dct:hasPart ?target .
    ?target prov:wasRevisionOf ?previousURI .
}  
  `;
  const data = await mu.query(selectTargets);
  const targets = data.results.bindings.map((binding) => {
    return binding.target.value;
  });
  return updatePropertiesOnAgendaItemsBatched(targets);
};

const updatePropertiesOnAgendaItemsBatched = async function (targets) {
  if (!targets || targets.length === 0) {
    console.log('all done updating properties of agendaitems');
    return;
  }

  let targetsToDo = [];
  if (targets.length > batchSize) {
    console.log(`Agendaitems list exceeds the batchSize of ${batchSize}, splitting into batches`);
    targetsToDo = targets.splice(0, batchSize);
  }
  const ignoredPropertiesLeft = [
    'http://mu.semte.ch/vocabularies/core/uuid',
    'http://www.w3.org/ns/prov#wasRevisionOf',
    'http://data.vlaanderen.be/ns/besluitvorming#aanmaakdatum' // TODO: not part of besluitvorming namespace
  ];
  const movePropertiesLeft = `
  PREFIX prov: <http://www.w3.org/ns/prov#>

  INSERT { 
    GRAPH <${targetGraph}> {
      ?target ?p ?o .
    }
  } WHERE {
    VALUES (?target) {
      (${targets.map(sparqlEscapeUri).join(') (\n      ')})
    }
    ?target prov:wasRevisionOf ?previousURI .
    ?previousURI ?p ?o .
    FILTER(?p NOT IN (${ignoredPropertiesLeft.map(sparqlEscapeUri).join(', ')}))
  }`;
  await mu.update(movePropertiesLeft);

  const ignoredPropertiesRight = [
    'http://purl.org/dc/terms/hasPart',
    'http://www.w3.org/ns/prov#wasRevisionOf'
  ];
  const movePropertiesRight = `
  PREFIX prov: <http://www.w3.org/ns/prov#>

  INSERT { 
    GRAPH <${targetGraph}> {
      ?o ?p ?target .
    }
  } WHERE {
    VALUES (?target) {
      (${targets.map(sparqlEscapeUri).join(') (\n      ')})
    }
    ?target prov:wasRevisionOf ?previousURI .
    ?o ?p ?previousURI .
    FILTER(?p NOT IN (${ignoredPropertiesRight.map(sparqlEscapeUri).join(', ')}))
  }`;
  await mu.update(movePropertiesRight);

  return updatePropertiesOnAgendaItemsBatched(targetsToDo);
};

const copyAgendaItems = async (oldAgendaUri, newAgendaUri) => {
  const agendaItemUris = (await selectAgendaItems(oldAgendaUri)).map(res => res.agendaitem);

  for (const oldVerUri of agendaItemUris) {
    const uuid = generateUuid();
    const newVerUri = AGENDA_ITEM_RESOURCE_BASE + uuid;
    const creationDate = new Date();
    const createNewVer = `
PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX dct: <http://purl.org/dc/terms/>

INSERT DATA { 
    ${sparqlEscapeUri(newVerUri)} a besluit:Agendapunt ;
        mu:uuid ${sparqlEscapeString(uuid)} ;
        besluitvorming:aanmaakdatum ${sparqlEscapeDateTime(creationDate)} ;
        prov:wasRevisionOf ${sparqlEscapeUri(oldVerUri)} .
    ${sparqlEscapeUri(newAgendaUri)} dct:hasPart ${sparqlEscapeUri(newVerUri)} .
}`;
    // TODO: "aanmaakdatum" not part of besluitvorming namespace
    await mu.update(createNewVer);
  }
  return updatePropertiesOnAgendaItems(newAgendaUri);
};

export {
  createNewAgenda,
  approveAgenda,
  storeAgendaItemNumbers,
  copyAgendaItems
};
