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
  return data.results.bindings[0].meeting.value;
};

const closeMeeting = async (meetingURI, agendaURI) => {
  const modifiedDate = new Date();
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX mulit: <http://mu.semte.ch/vocabularies/typed-literals/>

  DELETE {
    GRAPH <${targetGraph}> { 
      ${sparqlEscapeUri(meetingURI)} besluitvorming:behandelt ?oldAgenda ;
        dct:modified ?oldModified ;
        ext:finaleZittingVersie ?oldStatus .
    }
  }
  INSERT {
    GRAPH <${targetGraph}> { 
      ${sparqlEscapeUri(meetingURI)} besluitvorming:behandelt ${sparqlEscapeUri(agendaURI)} ;
        dct:modified ${sparqlEscapeDateTime(modifiedDate)} ;
        ext:finaleZittingVersie "true"^^mulit:boolean .
    }
  }
  WHERE {
    ${sparqlEscapeUri(meetingURI)} a besluit:Vergaderactiviteit ;
      dct:modified ?oldModified ;
      ^besluitvorming:isAgendaVoor ${sparqlEscapeUri(agendaURI)} .
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

  const result = await mu.query(query)
  return result.results.bindings[0].designAgenda.value;
}

const getLastApprovedAgenda = async (meetingURI) => {
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX mulit: <http://mu.semte.ch/vocabularies/typed-literals/>

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
  const parsedResult = util.parseSparqlResults(result);
  return parsedResult[0];
}

export {
  getMeetingURI,
  closeMeeting,
  getDesignAgenda,
  getLastApprovedAgenda,
};
