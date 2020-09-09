import mu, {
  sparqlEscapeString,
  sparqlEscapeUri
} from 'mu';
import * as util from '../util/index';

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

/**
 * Retrieves the agendaItem uris from an agenda
 * @name selectAgendaItems
 * @function
 * @param {String} agendaURI - The URI of the agenda containing the agendaitem URIs
 */
const selectAgendaItems = async (agendaURI) => {
  const query = `
  PREFIX dct: <http://purl.org/dc/terms/>

  SELECT DISTINCT ?agendaitem
  WHERE {
      ${sparqlEscapeUri(agendaURI)} dct:hasPart ?agendaitem .
  }`;
  const result = await mu.query(query);
  return util.parseSparqlResults(result);
};

export {
  getAgendaURI,
  selectAgendaItems
};
