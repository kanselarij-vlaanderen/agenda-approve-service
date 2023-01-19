import mu, {
  sparqlEscapeString,
  sparqlEscapeUri
} from 'mu';
import * as util from '../util/index';

const AGENDA_STATUS_DESIGN = 'http://themis.vlaanderen.be/id/concept/agenda-status/b3d8a99b-0a7e-419e-8474-4b508fa7ab91';

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


const getMeetingURIFromAgenda = async (agendaURI) => {
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>

  SELECT DISTINCT ?meeting WHERE {
    ${sparqlEscapeUri(agendaURI)} besluitvorming:isAgendaVoor ?meeting .
  }`;

  const data = await mu.query(query).catch(err => {
    console.error(err);
  });
  if (data.results.bindings.length) {
    return data.results.bindings[0].meeting.value;
  }
  throw new Error(`Meeting for agendaURI ${agendaURI} not found`);

};

const closeMeeting = async (agendaURI) => {
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mulit: <http://mu.semte.ch/vocabularies/typed-literals/>
  PREFIX ext:  <http://mu.semte.ch/vocabularies/ext/>

  DELETE {
    ?meetingURI besluitvorming:behandelt ?oldAgenda ;
      ext:finaleZittingVersie ?oldStatus .
  }
  INSERT {
    ?meetingURI besluitvorming:behandelt ${sparqlEscapeUri(agendaURI)} ;
      ext:finaleZittingVersie "true"^^mulit:boolean .
  }
  WHERE {
    ?meetingURI a besluit:Vergaderactiviteit .
    ${sparqlEscapeUri(agendaURI)} besluitvorming:isAgendaVoor ?meetingURI .
    OPTIONAL { ?meetingURI ext:finaleZittingVersie ?oldStatus . }
    OPTIONAL { ?meetingURI besluitvorming:behandelt ?oldAgenda . }
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

const getDesignAgendaFromMeetingURI = async (meetingURI) => {
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

const getDesignAgenda = async (agendaId) => {
  const query = `
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>

  SELECT ?designAgenda
  WHERE {
    ?designAgenda a besluitvorming:Agenda;
      mu:uuid ${sparqlEscapeString(agendaId)} ;
      besluitvorming:agendaStatus ${sparqlEscapeUri(AGENDA_STATUS_DESIGN)} .
  }`;

  const result = await mu.query(query);
  if (result.results.bindings.length) {
    return result.results.bindings[0].designAgenda.value;
  }
  return null;
}

/**
 * Gets the last approved agenda from the given meeting
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
 * @returns {*} agendaURI
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
  getMeetingURIFromAgenda,
  closeMeeting,
  reopenMeeting,
  getDesignAgenda,
  getDesignAgendaFromMeetingURI,
  getLastApprovedAgenda,
  getLastestAgenda,
  updateLastApprovedAgenda,
};
