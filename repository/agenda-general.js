import mu, {
  sparqlEscapeString,
  sparqlEscapeUri
} from 'mu';
import * as util from '../util/index';

const AGENDAITEM_FORMALLY_OK = 'http://kanselarij.vo.data.gift/id/concept/goedkeurings-statussen/CC12A7DB-A73A-4589-9D53-F3C2F4A40636';

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

/**
 * Retrieves the agendaitem uris that are not formally ok from an agenda
 * and need to be rolled back to a previous version during approval
 * @name selectAgenselectAgendaitemNotFormallyOkdaItems
 * @function
 * @param {String} agendaURI - The URI of the agenda containing the agendaitem URIs
 */
const selectAgendaitemNotFormallyOk = async (agendaURI) => {
  const query = `
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX ext:  <http://mu.semte.ch/vocabularies/ext/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

  SELECT DISTINCT ?agendaitem
  WHERE {
      ${sparqlEscapeUri(agendaURI)} dct:hasPart ?agendaitem .
      ?agendaitem ext:formeelOK ?formeelOK .
      FILTER EXISTS { ?agendaitem prov:wasRevisionOf ?previous . }
      FILTER(?formeelOK != ${sparqlEscapeUri(AGENDAITEM_FORMALLY_OK)})
  }`;
  const result = await mu.query(query);
  return util.parseSparqlResults(result);
};

export {
  getAgendaURI,
  selectAgendaItems,
  selectAgendaitemNotFormallyOk,
};
