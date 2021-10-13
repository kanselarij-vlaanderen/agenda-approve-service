import mu, {
  sparqlEscapeString,
  sparqlEscapeUri
} from 'mu';
import * as util from '../util/index';

const AGENDA_STATUS_DESIGN = 'http://kanselarij.vo.data.gift/id/agendastatus/2735d084-63d1-499f-86f4-9b69eb33727f';

const getMeetingURI = async (meetingId) => {
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

  SELECT DISTINCT ?meeting WHERE {
    ?meeting a besluit:Vergaderactiviteit ;
      mu:uuid ${sparqlEscapeString(meetingId)} .
  }`;

  const data = await mu.query(query).catch(err => {
    console.error(err);
  });
  if (data.results.bindings.length) {
    return data.results.bindings[0].meeting.value;
  }
  throw new Error(`Meeting with id ${meetingId} not found`);

};

const closeMeeting = async (meetingURI, agendaURI) => {
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mulit: <http://mu.semte.ch/vocabularies/typed-literals/>
  PREFIX ext:  <http://mu.semte.ch/vocabularies/ext/>

  DELETE {
    ${sparqlEscapeUri(meetingURI)} besluitvorming:behandelt ?oldAgenda ;
      ext:finaleZittingVersie ?oldStatus .
  }
  INSERT {
    ${sparqlEscapeUri(meetingURI)} besluitvorming:behandelt ${sparqlEscapeUri(agendaURI)} ;
      ext:finaleZittingVersie "true"^^mulit:boolean .
  }
  WHERE {
    ${sparqlEscapeUri(meetingURI)} a besluit:Vergaderactiviteit .
    ${sparqlEscapeUri(agendaURI)} besluitvorming:isAgendaVoor ${sparqlEscapeUri(meetingURI)} .
    OPTIONAL { ${sparqlEscapeUri(meetingURI)} ext:finaleZittingVersie ?oldStatus . }
    OPTIONAL { ${sparqlEscapeUri(meetingURI)} besluitvorming:behandelt ?oldAgenda . }
  }`;
  return await mu.update(query);
}

const reopenMeeting = async (meetingURI) => {
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mulit: <http://mu.semte.ch/vocabularies/typed-literals/>
  PREFIX ext:  <http://mu.semte.ch/vocabularies/ext/>

  DELETE {
    ${sparqlEscapeUri(meetingURI)} besluitvorming:behandelt ?oldAgenda ;
      ext:finaleZittingVersie ?oldStatus .
  }
  INSERT {
    ${sparqlEscapeUri(meetingURI)} ext:finaleZittingVersie "false"^^mulit:boolean .
  }
  WHERE {
    ${sparqlEscapeUri(meetingURI)} a besluit:Vergaderactiviteit .
    OPTIONAL { ${sparqlEscapeUri(meetingURI)} ext:finaleZittingVersie ?oldStatus . }
    OPTIONAL { ${sparqlEscapeUri(meetingURI)} besluitvorming:behandelt ?oldAgenda . }
  }`;
  return await mu.update(query);
}

const getDesignAgenda = async (meetingURI) => {
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>

  SELECT ?designAgenda
  WHERE {
    ${sparqlEscapeUri(meetingURI)} a besluit:Vergaderactiviteit .
    ?designAgenda besluitvorming:isAgendaVoor ${sparqlEscapeUri(meetingURI)} ;
      a besluitvorming:Agenda;
      besluitvorming:agendaStatus ${sparqlEscapeUri(AGENDA_STATUS_DESIGN)} .
  }`;

  const result = await mu.query(query);
  if (result.results.bindings.length) {
    return result.results.bindings[0].designAgenda.value;
  }
  return null;
}

/**
 * Gets the last approved (or closed = final approved) agenda from the given meeting
 *
 * @param {string} meetingURI - The meeting to query from
 * @returns {*} {lastApprovedId, lastApprovedAgendaUri} or null
 */
const getLastApprovedAgenda = async (meetingURI) => {
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

  SELECT (?agendaId AS ?lastApprovedId) (?agenda AS ?lastApprovedAgendaUri) 
  WHERE {
    ${sparqlEscapeUri(meetingURI)} a besluit:Vergaderactiviteit .
    ?agenda besluitvorming:isAgendaVoor ${sparqlEscapeUri(meetingURI)} ;
      a besluitvorming:Agenda ;
      mu:uuid ?agendaId ;
      besluitvorming:volgnummer ?serialnumber .
    FILTER NOT EXISTS { ?agenda besluitvorming:agendaStatus ${sparqlEscapeUri(AGENDA_STATUS_DESIGN)} . }
  } ORDER BY DESC(?serialnumber) LIMIT 1
  `;

  const result = await mu.query(query);
  if (result.results.bindings[0]) {
    const parsedResult = util.parseSparqlResults(result);
    return { id: parsedResult[0].lastApprovedId, uri: parsedResult[0].lastApprovedAgendaUri };
  }
  return null;
}

/**
 * Gets the latest agenda from the given meeting, regardless of the agenda status
 *
 * @param {uri} meetingURI
 * @returns {*} agendaURI or null
 */
const getLastestAgenda = async (meetingURI) => {
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>

  SELECT DISTINCT ?agenda
  WHERE {
    ${sparqlEscapeUri(meetingURI)} a besluit:Vergaderactiviteit .
    ?agenda besluitvorming:isAgendaVoor ${sparqlEscapeUri(meetingURI)} ;
      a besluitvorming:Agenda ;
      besluitvorming:volgnummer ?serialnumber .
  } ORDER BY DESC(?serialnumber) LIMIT 1
  `;

  const result = await mu.query(query);
  if (result.results.bindings.length) {
    return result.results.bindings[0].agenda.value;
  }
  // should be unreachable, a meeting without agendas shouldn't exist
  throw new Error(`No agendas found for meeting ${meetingURI}`);
}

/**
 * In order to trigger a cache invalidation in some cases
 * We delete and reinsert the relation between meeting and agenda
 *
 * @param {uri} meetingURI 
 * @param {uri} lastApprovedAgendaUri 
 * @returns {void}
 */
const updateLastApprovedAgenda = async (meetingURI, lastApprovedAgendaUri) => {
  // TODO Workaround for cache not updating when an agenda with only an approval is deleted
  const deleteQuery = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>

  DELETE DATA {
    ${sparqlEscapeUri(lastApprovedAgendaUri)} besluitvorming:isAgendaVoor ${sparqlEscapeUri(meetingURI)} .
  }`;

  const insertQuery = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>

  INSERT DATA {
    ${sparqlEscapeUri(lastApprovedAgendaUri)} besluitvorming:isAgendaVoor ${sparqlEscapeUri(meetingURI)} .
  }`;
  await mu.update(deleteQuery);
  return await mu.update(insertQuery);
}

export {
  getMeetingURI,
  closeMeeting,
  reopenMeeting,
  getDesignAgenda,
  getLastApprovedAgenda,
  getLastestAgenda,
  updateLastApprovedAgenda,
};
