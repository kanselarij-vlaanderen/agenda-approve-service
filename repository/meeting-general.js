import mu, {
  sparqlEscapeDateTime,
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
  return data.results.bindings[0].meeting.value;
};

const closeMeeting = async (meetingURI, agendaURI) => {
  // TODO KAS-2452 defaults for isFinal, modified and agenda ? optionals are needed because data does not exist
  const modifiedDate = new Date();
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX mulit: <http://mu.semte.ch/vocabularies/typed-literals/>
  PREFIX ext:  <http://mu.semte.ch/vocabularies/ext/>

  DELETE {
    ${sparqlEscapeUri(meetingURI)} besluitvorming:behandelt ?oldAgenda ;
      dct:modified ?oldModified ;
      ext:finaleZittingVersie ?oldStatus .
  }
  INSERT {
    ${sparqlEscapeUri(meetingURI)} besluitvorming:behandelt ${sparqlEscapeUri(agendaURI)} ;
      dct:modified ${sparqlEscapeDateTime(modifiedDate)} ;
      ext:finaleZittingVersie "true"^^mulit:boolean .
  }
  WHERE {
    ${sparqlEscapeUri(meetingURI)} a besluit:Vergaderactiviteit ;
      ^besluitvorming:isAgendaVoor ${sparqlEscapeUri(agendaURI)} .
      OPTIONAL { ${sparqlEscapeUri(meetingURI)} dct:modified ?oldModified . }
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
    ${sparqlEscapeUri(meetingURI)} a besluit:Vergaderactiviteit ;
      ^besluitvorming:isAgendaVoor ?designAgenda .
      ?designAgenda besluitvorming:agendaStatus ${sparqlEscapeUri(AGENDA_STATUS_DESIGN)} .
  }`;

  const result = await mu.query(query);
  if (result.results.bindings.length) {
    return result.results.bindings[0].designAgenda.value;
  }
  return null;
}

const getLastApprovedAgenda = async (meetingURI) => {
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX mulit: <http://mu.semte.ch/vocabularies/typed-literals/>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

  SELECT (?agendaId AS ?lastApprovedId) (?agenda AS ?lastApprovedAgendaUri) 
  WHERE {
    ${sparqlEscapeUri(meetingURI)} a besluit:Vergaderactiviteit ;
      ^besluitvorming:isAgendaVoor ?agenda .
      ?agenda mu:uuid ?agendaId ;
        besluitvorming:volgnummer ?serialnumber .
      FILTER NOT EXISTS { ?agenda besluitvorming:agendaStatus ${sparqlEscapeUri(AGENDA_STATUS_DESIGN)} . }
  } ORDER BY DESC(?serialnumber) LIMIT 1
  `;

  const result = await mu.query(query);
  console.log('************ result', result )
  const parsedResult = util.parseSparqlResults(result);
  console.log('************ parsedResult', parsedResult )
  return [parsedResult[0].lastApprovedId, parsedResult[0].lastApprovedAgendaUri];
}

export {
  getMeetingURI,
  closeMeeting,
  getDesignAgenda,
  getLastApprovedAgenda,
};
