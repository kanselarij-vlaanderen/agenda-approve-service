import mu, { sparqlEscapeUri } from 'mu';

const deleteMeetingAndNewsletter = async (meetingURI) => {
  await deleteNewsletter(meetingURI);
  await deleteMeeting(meetingURI);
};

const deleteNewsletter = async (meetingURI) => {
  const query = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX ext:  <http://mu.semte.ch/vocabularies/ext/>

  DELETE {
    ?newsletter ?p ?o .
    ?s ?pp ?newsletter .
  } WHERE {
    ${sparqlEscapeUri(meetingURI)} ext:algemeneNieuwsbrief ?newsletter .
    ?newsletter a besluitvorming:NieuwsbriefInfo ;
      ?p ?o .
    OPTIONAL {
      ?s ?pp ?newsletter .
    }
    FILTER NOT EXISTS { ?anyAgenda besluitvorming:isAgendaVoor ${sparqlEscapeUri(meetingURI)} . }
  }`;
  await mu.update(query);
};

const deleteMeeting = async (meetingURI) => {
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>

  DELETE {
    ${sparqlEscapeUri(meetingURI)} ?p ?o .
    ?s ?pp ${sparqlEscapeUri(meetingURI)} .
  } WHERE {
    ${sparqlEscapeUri(meetingURI)} a besluit:Vergaderactiviteit ;
      ?p ?o .
    OPTIONAL {
      ?s ?pp ${sparqlEscapeUri(meetingURI)} .
    }
    FILTER NOT EXISTS { ?anyAgenda besluitvorming:isAgendaVoor ${sparqlEscapeUri(meetingURI)} . }
  }`;
  await mu.update(query);
};

export {
  deleteMeetingAndNewsletter,
};