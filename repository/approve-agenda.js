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
  const { meetingUri, agendaCount, meetingDate } = await meetingInfo(meetingUuid);
  const serialNumber = serialNumbers[agendaCount] || agendaCount;
  const title = `Agenda ${serialNumber} voor zitting ${moment(meetingDate).format('D-M-YYYY')}`;
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

const meetingInfo = async (meetingUuid) => {
  const query = `
PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

SELECT ?meeting ?meetingDate (COUNT(DISTINCT(?agenda)) AS ?agendacount) WHERE {
    ?meeting a besluit:Vergaderactiviteit ;
        besluit:geplandeStart ?meetingDate ;
        mu:uuid ${sparqlEscapeString(meetingUuid)} .
    ?agenda besluitvorming:isAgendaVoor ?meeting .
}
GROUP BY ?meeting ?meetingDate`;
  const data = await mu.query(query).catch(err => {
    console.error(err);
  });
  const firstResult = data.results.bindings[0] || {};
  return {
    meetingUri: firstResult.meeting.value,
    meetingDate: firstResult.meetingDate.value,
    agendaCount: parseInt(firstResult.agendacount.value)
  };
};

const updatePropertiesOnAgendaitems = async function (agendaUri) {
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
  return updatePropertiesOnAgendaitemsBatched(targets);
};

const updatePropertiesOnAgendaitemsBatched = async function (targets) {
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
    'http://purl.org/dc/terms/created',
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

  return updatePropertiesOnAgendaitemsBatched(targetsToDo);
};

const copyAgendaitems = async (oldAgendaUri, newAgendaUri) => {
  const agendaitemUris = await agendaGeneral.selectAgendaitems(oldAgendaUri);

  for (const oldVerUri of agendaitemUris) {
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
        dct:created ${sparqlEscapeDateTime(creationDate)} ;
        prov:wasRevisionOf ${sparqlEscapeUri(oldVerUri)} .
    ${sparqlEscapeUri(newAgendaUri)} dct:hasPart ${sparqlEscapeUri(newVerUri)} .
}`;
    await mu.update(createNewVer);
  }
  return updatePropertiesOnAgendaitems(newAgendaUri);
};

const removeNewAgendaitems = async (agendaUri) => {
  console.debug('****************** formally ok rules - remove new items ******************');
  const agendaitemUris = (await agendaGeneral.selectNewAgendaitemsNotFormallyOk(agendaUri));

  for (const agendaitemUri of agendaitemUris) {
    await deleteAgendaitem(agendaitemUri);
  }
}

const rollbackAgendaitems = async (oldAgendaUri) => {
  console.debug('****************** formally ok rules - rollback approved items ******************');
  const agendaitemUris = (await agendaGeneral.selectApprovedAgendaitemsNotFormallyOk(oldAgendaUri));

  /* During rollback, we don't want to delete / insert: 
    objects:
    - the type, query for besluit:Agendapunt would fail after
    - the uuid, we want to keep the same object, just empty it and refill it with old values
    - the wasRevisionOf, the link to previous agendaitem is kept
    - the position, because when multiple items are manually moved and only 1 gets rolled back, we get double numbers. (it makes sense, but hard to explain)
    subjects:
    - the relation to the agenda this version of the agendaitem is linked to
    - the link to the next version of agendaitem (if any)
    - the link to agenda-activity (delete and insert could be allowed, should be the same relation)
  */
  const ignoredObjects = [
    'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
    'http://mu.semte.ch/vocabularies/core/uuid',
    'http://www.w3.org/ns/prov#wasRevisionOf',
    'http://schema.org/position',
  ];
  const ignoredSubjects = [
    'http://purl.org/dc/terms/hasPart',
    'http://www.w3.org/ns/prov#wasRevisionOf',
    'http://data.vlaanderen.be/ns/besluitvorming#genereertAgendapunt'
  ];

  for (const oldVerUri of agendaitemUris) {
    const rollbackDeleteQuery = `
PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>

DELETE {
  ${sparqlEscapeUri(oldVerUri)} ?p ?object .
  ?subject ?pp ${sparqlEscapeUri(oldVerUri)} .
} WHERE {
  ${sparqlEscapeUri(oldVerUri)} a besluit:Agendapunt ;
  ?p ?object .
  FILTER(?p NOT IN (${ignoredObjects.map(sparqlEscapeUri).join(', ')}))

  ?subject ?pp ${sparqlEscapeUri(oldVerUri)} .
  FILTER(?pp NOT IN (${ignoredSubjects.map(sparqlEscapeUri).join(', ')}))
}
`;

    const rollbackInsertQuery = `
PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
PREFIX prov: <http://www.w3.org/ns/prov#>

INSERT {
  ${sparqlEscapeUri(oldVerUri)} ?p ?object .
  ?subject ?pp ${sparqlEscapeUri(oldVerUri)} .
} WHERE {
  ${sparqlEscapeUri(oldVerUri)} a besluit:Agendapunt ;
  prov:wasRevisionOf ?previousAgendaitem .
  ?previousAgendaitem ?p ?object .
  FILTER(?p NOT IN (${ignoredObjects.map(sparqlEscapeUri).join(', ')}))

  ?subject ?pp ?previousAgendaitem .
  FILTER(?pp NOT IN (${ignoredSubjects.map(sparqlEscapeUri).join(', ')}))
}
`;
    await mu.update(rollbackDeleteQuery);
    await mu.update(rollbackInsertQuery);
  }
};

const sortAgendaitemsOnAgenda = async (agendaUri, newAgendaitems) => {
  console.debug('****************** formally ok rules - sorting agendaitems on agenda ******************');
  const agendaitems = await agendaGeneral.selectAgendaitemsForSorting(agendaUri);

  // If we have newAgendaitems on this agenda, it means they have to be sorted to the bottom of the list
  // so we find them and push them to the end of the array
  if (newAgendaitems) {
    const itemsToShift = agendaitems.filter(agendaitem => newAgendaitems.find(item => agendaitem.agendaitem == item));
    itemsToShift.map((agendaitem) => {
      agendaitems.push(agendaitems.splice(agendaitems.indexOf(agendaitem), 1)[0]);
    });
  }
  // .filter keeps reference to the same objects
  const notes = agendaitems.filter(agendaitem => agendaitem.isRemark == "false");
  const announcements = agendaitems.filter(agendaitem => agendaitem.isRemark == "true");

  // for both lists, we have to fill in any gaps in numbering made by rollbacks or deletes
  reOrderAgendaitemNumbers(notes);
  reOrderAgendaitemNumbers(announcements);

  for (const target of agendaitems) {
    // only update if update is needed, should do nothing in a happy flow scenario
    if (target.newNumber) {
      const query = `
      PREFIX schema: <http://schema.org/>
  
      DELETE {
        ${sparqlEscapeUri(target.agendaitem)} schema:position ?number .
      }
      INSERT {
        ${sparqlEscapeUri(target.agendaitem)} schema:position ${sparqlEscapeInt(target.newNumber)} .
      }
      WHERE {
        ${sparqlEscapeUri(target.agendaitem)} schema:position ?number .
      }
      `;
      await mu.update(query);
    }
  }
  return;
};

const sortNewAgenda = async (agendaUri) => {
  console.debug('****************** formally ok rules - sorting agendaitems on new agenda ******************');
  const newAgendaitems = (await agendaGeneral.selectNewAgendaitemsNotFormallyOk(agendaUri));

  // If we had any targets, sort the agendaitems of the entire agenda
  if (newAgendaitems) {
    await sortAgendaitemsOnAgenda(agendaUri, newAgendaitems);
  }
};

const reOrderAgendaitemNumbers = (array) => {
  array.map((agendaitem, index) => {
    if (parseInt(agendaitem.number) !== index + 1) {
      agendaitem.newNumber = index + 1;
    }
  });
}

export {
  createNewAgenda,
  copyAgendaitems,
  removeNewAgendaitems,
  rollbackAgendaitems,
  sortAgendaitemsOnAgenda,
  sortNewAgenda,
};
