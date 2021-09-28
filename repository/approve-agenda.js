import mu, {
  sparqlEscapeDateTime,
  sparqlEscapeInt,
  sparqlEscapeString,
  sparqlEscapeUri,
  uuid as generateUuid
} from 'mu';
import moment from 'moment';
import * as agendaGeneral from './agenda-general';
import { deleteAgendaitem } from './delete-agenda';

const batchSize = process.env.BATCH_SIZE || 100;

const AGENDA_RESOURCE_BASE = 'http://themis.vlaanderen.be/id/agenda/';
const AGENDA_ITEM_RESOURCE_BASE = 'http://themis.vlaanderen.be/id/agendapunt/';
const AGENDA_STATUS_DESIGN = 'http://kanselarij.vo.data.gift/id/agendastatus/2735d084-63d1-499f-86f4-9b69eb33727f';

const createNewAgenda = async (meetingUuid, oldAgendaURI) => {
  const newAgendaUuid = generateUuid();
  const newAgendaUri = AGENDA_RESOURCE_BASE + newAgendaUuid;
  const creationDate = new Date();
  const serialNumbers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const { meetingUri, agendaCount, zittingDate } = await zittingInfo(meetingUuid);
  const serialNumber = serialNumbers[agendaCount] || agendaCount;
  const title = `Agenda ${serialNumber} voor zitting ${moment(zittingDate).format('D-M-YYYY')}`;
  const query = `
PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>

INSERT DATA {
  ${sparqlEscapeUri(newAgendaUri)} a besluitvorming:Agenda ;
    mu:uuid ${sparqlEscapeString(newAgendaUuid)} ;
    dct:created ${sparqlEscapeDateTime(creationDate)} ;
    dct:modified ${sparqlEscapeDateTime(creationDate)} ;
    dct:title ${sparqlEscapeString(title)} ;
    besluitvorming:agendaStatus ${sparqlEscapeUri(AGENDA_STATUS_DESIGN)} ;
    besluitvorming:isAgendaVoor ${sparqlEscapeUri(meetingUri)} ;
    besluitvorming:volgnummer ${sparqlEscapeString(serialNumber)} ;
    prov:wasRevisionOf ${sparqlEscapeUri(oldAgendaURI)}  .
}`;
  await mu.update(query).catch(err => {
    console.error(err);
  });
  return [newAgendaUuid, newAgendaUri];
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
    meetingUri: firstResult.zitting.value,
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
  ${triples.join('\n        ')}
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
  const ignoredObjects = [
    'http://mu.semte.ch/vocabularies/core/uuid',
    'http://www.w3.org/ns/prov#wasRevisionOf',
    'http://data.vlaanderen.be/ns/besluitvorming#aanmaakdatum' // TODO: not part of besluitvorming namespace
  ];
  const copyObjects = `
  PREFIX prov: <http://www.w3.org/ns/prov#>

  INSERT { 
    ?target ?p ?o .
  } WHERE {
    VALUES (?target) {
      (${targets.map(sparqlEscapeUri).join(')\n      (')})
    }
    ?target prov:wasRevisionOf ?previousURI .
    ?previousURI ?p ?o .
    FILTER(?p NOT IN (${ignoredObjects.map(sparqlEscapeUri).join(', ')}))
  }`;
  await mu.update(copyObjects);

  const ignoredSubjects = [
    'http://purl.org/dc/terms/hasPart',
    'http://www.w3.org/ns/prov#wasRevisionOf'
  ];
  const copySubjects = `
  PREFIX prov: <http://www.w3.org/ns/prov#>

  INSERT { 
    ?s ?p ?target .
  } WHERE {
    VALUES (?target) {
      (${targets.map(sparqlEscapeUri).join(')\n      (')})
    }
    ?target prov:wasRevisionOf ?previousURI .
    ?s ?p ?previousURI .
    FILTER(?p NOT IN (${ignoredSubjects.map(sparqlEscapeUri).join(', ')}))
  }`;
  await mu.update(copySubjects);

  return updatePropertiesOnAgendaItemsBatched(targetsToDo);
};

const copyAgendaItems = async (oldAgendaUri, newAgendaUri) => {
  const agendaItemUris = (await agendaGeneral.selectAgendaItems(oldAgendaUri)).map(res => res.agendaitem);

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

const enforceFormalOkRules = async (agendaUri) => {
  console.log('****************** enforcing formally ok rules ******************');
  let count = 0;
  // Remove new agendaitems that were not "formally ok" from agenda
  count += await removeAgendaItems(agendaUri);
  // Rollback approved agendaitems that were not "formally ok" from agenda
  count += await rollbackAgendaitems(agendaUri);
  // Optional: only if items were removed or rolled back (in case of priority also rolled back)
  if (count) {
    // Sort the agendaitems if needed
    await sortAgendaitemsOnAgenda(agendaUri);
  }
  return count;
}

const removeAgendaItems = async (agendaUri) => {
  console.log('****************** formally ok rules - remove new items ******************');
  const agendaitemUris = (await agendaGeneral.selectNewAgendaItemsNotFormallyOk(agendaUri)).map(res => res.agendaitem);
  const count = agendaitemUris.length;

  for (const agendaItemUri of agendaitemUris) {
    await deleteAgendaitem(agendaItemUri);
  }
  return count;
}

const rollbackAgendaitems = async (oldAgendaUri) => {
  console.log('****************** formally ok rules - rollback approved items ******************');
  const agendaitemUris = (await agendaGeneral.selectApprovedAgendaItemsNotFormallyOk(oldAgendaUri)).map(res => res.agendaitem);
  const count = agendaitemUris.length;

  for (const oldVerUri of agendaitemUris) {
    const rollbackDeleteQuery = `
PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

DELETE {
  ${sparqlEscapeUri(oldVerUri)} ?p ?rightTarget .
  ?leftTarget ?pp ${sparqlEscapeUri(oldVerUri)} .
} WHERE {
  ${sparqlEscapeUri(oldVerUri)} a besluit:Agendapunt ;
  ?p ?rightTarget .
  FILTER(?p NOT IN (rdf:type, mu:uuid, prov:wasRevisionOf, ext:prioriteit) )

  ?leftTarget ?pp ${sparqlEscapeUri(oldVerUri)} .
  FILTER(?pp NOT IN (dct:hasPart, besluitvorming:genereertAgendapunt, prov:wasRevisionOf ))
}
`;

    const rollbackInsertQuery = `
PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

INSERT {
  ${sparqlEscapeUri(oldVerUri)} ?p ?rightTarget .
  ?leftTarget ?pp ${sparqlEscapeUri(oldVerUri)} .
} WHERE {
  ${sparqlEscapeUri(oldVerUri)} a besluit:Agendapunt ;
  prov:wasRevisionOf ?previousAgendaitem .
  ?previousAgendaitem ?p ?rightTarget .
  FILTER(?p NOT IN (rdf:type, mu:uuid, prov:wasRevisionOf) )

  ?leftTarget ?pp ?previousAgendaitem .
  FILTER(?pp NOT IN (dct:hasPart, besluitvorming:genereertAgendapunt, prov:wasRevisionOf ))
}
`;
    await mu.update(rollbackDeleteQuery);
    await mu.update(rollbackInsertQuery);
  }
  return count;
};

const sortAgendaitemsOnAgenda = async (agendaUri) => {
  console.log('****************** formally ok rules - sorting agendaitems on agenda ******************');
  const agendaitems = await agendaGeneral.selectAgendaItemsForSorting(agendaUri);
  const notes = agendaitems.filter(agendaitem => !agendaitem.isRemark);
  const announcements = agendaitems.filter(agendaitem => agendaitem.isRemark);
  const targetsToUpdate = [];

  notes.map((agendaitem, index) => {
    if (agendaitem.priority !== index + 1) {
      agendaitem.newPriority = index + 1;
      targetsToUpdate.push(agendaitem);
    }
  });

  announcements.map((agendaitem, index) => {
    if (agendaitem.priority !== index + 1) {
      agendaitem.newPriority = index + 1;
      targetsToUpdate.push(agendaitem);
    }
  });

  for (const target of targetsToUpdate) {
    // only update if update is needed
    if (target.priority !== target.newPriority) {
      const query = `
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  
      DELETE {
        ${sparqlEscapeUri(target.agendaitem)} ext:prioriteit ?priority .
      }
      INSERT {
        ${sparqlEscapeUri(target.agendaitem)} ext:prioriteit ${sparqlEscapeInt(target.newPriority)} .
      }
      WHERE {
        ${sparqlEscapeUri(target.agendaitem)} ext:prioriteit ?priority .
      }
      `;
      await mu.update(query);
    }
  }
  return;
};

const sortNewAgenda = async (agendaUri) => {
  console.log('****************** formally ok rules - sorting agendaitems on new agenda ******************');
  const newAgendaitems = (await agendaGeneral.selectNewAgendaItemsNotFormallyOk(agendaUri));
  newAgendaitems.map((agendaitem, index) => {
    agendaitem.newPriority = index + 999;
  });
  for (const target of newAgendaitems) {
    const query = `
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

      DELETE {
        ${sparqlEscapeUri(target.agendaitem)} ext:prioriteit ?priority .
      }
      INSERT {
        ${sparqlEscapeUri(target.agendaitem)} ext:prioriteit ${sparqlEscapeInt(target.newPriority)} .
      }
      WHERE {
        ${sparqlEscapeUri(target.agendaitem)} ext:prioriteit ?priority .
      }
      `;
    await mu.update(query);
  }

  // If we had any targets, sort the agendaitems of the entire agenda
  if (newAgendaitems) {
    await sortAgendaitemsOnAgenda(agendaUri);
  }
};


export {
  createNewAgenda,
  storeAgendaItemNumbers,
  copyAgendaItems,
  rollbackAgendaitems,
  enforceFormalOkRules,
  sortNewAgenda,
};
