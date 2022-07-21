import mu, { sparqlEscapeUri } from 'mu';
import * as util from '../util/index';

/*
  The reason for the use of sleep is due to a "bug" in mu-cache keys clearing.
  If we execute all DELETE statements after each other, the corresponding keys are not cleared
  If we wait some time (can take between 0.5 and 2.x seconds (or longer?)) then cache cleares happen between deletes
  Specifically causes stale data when a meeting with only an approval agendaitem is deleted
  The delete actions are barely used on production and more during testing, so this workaround is acceptable
*/
const deleteMeetingAndNewsletter = async (meetingURI) => {
  await deletePublicationActivities(meetingURI);
  await deleteNewsletter(meetingURI);
  await util.sleep();
  await deleteMeeting(meetingURI);
};

const deletePublicationActivities = async (meetingURI) => {
  const query = `
  PREFIX ext:  <http://mu.semte.ch/vocabularies/ext/>
  PREFIX prov: <http://www.w3.org/ns/prov#>

  DELETE {
    ?s ?p ?o .
  } WHERE {
    ?activity ?pubPredicate ${sparqlEscapeUri(meetingURI)} ;
      ?p ?o .
    VALUES ?pubPredicate {
      ext:internalDecisionPublicationActivityUsed
      ext:internalDocumentPublicationActivityUsed
      prov:used
    }
  }`;
  await mu.update(query);
}

const deleteNewsletter = async (meetingURI) => {
  const query = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX ext:  <http://mu.semte.ch/vocabularies/ext/>

  DELETE {
    ?newsletter ?p ?o .
    ?s ?pp ?newsletter .
  } WHERE {
    ${sparqlEscapeUri(meetingURI)} ext:algemeneNieuwsbrief ?newsletter .
    ?newsletter a besluitvorming:NieuwsbriefInfo .
    OPTIONAL { ?newsletter ?p ?o . }
    OPTIONAL {
      ?s ?pp ?newsletter .
    }
  }`;
  await mu.update(query);
};

const deleteMeeting = async (meetingURI) => {
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>

  DELETE {
    ${sparqlEscapeUri(meetingURI)} ?p ?o .
    ?s ?pp ${sparqlEscapeUri(meetingURI)} .
  } WHERE {
    ${sparqlEscapeUri(meetingURI)} a besluit:Vergaderactiviteit .
    OPTIONAL { ${sparqlEscapeUri(meetingURI)} ?p ?o . }
    OPTIONAL {
      ?s ?pp ${sparqlEscapeUri(meetingURI)} .
    }
  }`;
  await mu.update(query);
};

export {
  deleteMeetingAndNewsletter,
};
