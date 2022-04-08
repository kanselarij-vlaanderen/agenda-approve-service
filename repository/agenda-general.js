import mu, {
  sparqlEscapeDateTime,
  sparqlEscapeString,
  sparqlEscapeUri
} from 'mu';
import * as util from '../util/index';

const AGENDA_STATUS_DESIGN = 'http://kanselarij.vo.data.gift/id/agendastatus/2735d084-63d1-499f-86f4-9b69eb33727f';
const AGENDA_STATUS_APPROVED = 'http://kanselarij.vo.data.gift/id/agendastatus/ff0539e6-3e63-450b-a9b7-cc6463a0d3d1';
const AGENDA_STATUS_CLOSED = 'http://kanselarij.vo.data.gift/id/agendastatus/f06f2b9f-b3e5-4315-8892-501b00650101';
const AGENDAITEM_FORMALLY_OK = 'http://kanselarij.vo.data.gift/id/concept/goedkeurings-statussen/CC12A7DB-A73A-4589-9D53-F3C2F4A40636';

const getAgendaURI = async (agendaId) => {
  const query = `
   PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
   PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

   SELECT DISTINCT ?agenda WHERE {
    ?agenda a besluitvorming:Agenda ;
      mu:uuid ${sparqlEscapeString(agendaId)} .
   }
 `;

  const data = await mu.query(query).catch(err => {
    console.error(err);
  });
  if (data.results.bindings.length) {
    return data.results.bindings[0].agenda.value;
  }
  throw new Error(`Agenda with id ${agendaId} not found`);
};

/**
 * Retrieves the agendaitem uris from an agenda
 * @name selectAgendaitems
 * @function
 * @param {String} agendaURI - The URI of the agenda containing the agendaitem URIs
 * @returns {[String]} - a list of agendaitem URI's
 */
const selectAgendaitems = async (agendaURI) => {
  const query = `
  PREFIX dct: <http://purl.org/dc/terms/>

  SELECT DISTINCT ?agendaitem
  WHERE {
      ${sparqlEscapeUri(agendaURI)} dct:hasPart ?agendaitem .
  }`;
  const result = await mu.query(query);
  return result.results.bindings.map((binding) => {
    return binding.agendaitem.value;
  });
};

/**
 * Retrieves the agendaitem uris that are not formally ok from an agenda
 * and need to be rolled back to a previous version during approval
 * @name selectApprovedAgendaitemsNotFormallyOk
 * @function
 * @param {String} agendaURI - The URI of the agenda containing the agendaitem URIs
 */
const selectApprovedAgendaitemsNotFormallyOk = async (agendaURI) => {
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
  return result.results.bindings.map((binding) => {
    return binding.agendaitem.value;
  });
};

/**
 * Retrieves the new agendaitem uris that are not formally ok from an agenda
 * and need to be removed during approval
 * @name selectNewAgendaitemsNotFormallyOk
 * @function
 * @param {String} agendaURI - The URI of the agenda containing the agendaitem URIs
 */
const selectNewAgendaitemsNotFormallyOk = async (agendaURI) => {
  const query = `
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX ext:  <http://mu.semte.ch/vocabularies/ext/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

  SELECT DISTINCT ?agendaitem
  WHERE {
      ${sparqlEscapeUri(agendaURI)} dct:hasPart ?agendaitem .
      ?agendaitem ext:formeelOK ?formeelOK .
      FILTER NOT EXISTS { ?agendaitem prov:wasRevisionOf ?previous . }
      FILTER(?formeelOK != ${sparqlEscapeUri(AGENDAITEM_FORMALLY_OK)})
  }`;
  const result = await mu.query(query);
  return result.results.bindings.map((binding) => {
    return binding.agendaitem.value;
  });
};

/**
 * Retrieves the agendaitem uris from an agenda with some extra information
 * @name selectAgendaitemsForSorting
 * @function
 * @param {String} agendaURI - The URI of the agenda containing the agendaitem URIs
 */
const selectAgendaitemsForSorting = async (agendaURI) => {
  const query = `
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX ext:  <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX schema: <http://schema.org/>

  SELECT DISTINCT ?agendaitem ?number ?isRemark
  WHERE {
      ${sparqlEscapeUri(agendaURI)} dct:hasPart ?agendaitem .
      ?agendaitem a besluit:Agendapunt ;
        schema:position ?number ;
        ext:wordtGetoondAlsMededeling ?isRemark .
  } ORDER BY ?isRemark ?number
  `;
  const result = await mu.query(query);
  return util.parseSparqlResults(result);
};

const setAgendaStatusApproved = async (agendaURI) => {
  return await setAgendaStatus(agendaURI, AGENDA_STATUS_APPROVED);
};

const setAgendaStatusClosed = async (agendaURI) => {
  return await setAgendaStatus(agendaURI, AGENDA_STATUS_CLOSED);
};

const setAgendaStatusDesign = async (agendaURI) => {
  return await setAgendaStatus(agendaURI, AGENDA_STATUS_DESIGN);
};

const setAgendaStatus = async (agendaURI, statusURI) => {
  const modifiedDate = new Date();
  const query = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX dct: <http://purl.org/dc/terms/>

  DELETE {
    ${sparqlEscapeUri(agendaURI)} besluitvorming:agendaStatus ?oldAgendaStatus ;
      dct:modified ?oldModified .
  }
  INSERT {
    ${sparqlEscapeUri(agendaURI)} besluitvorming:agendaStatus ${sparqlEscapeUri(statusURI)} ;
      dct:modified ${sparqlEscapeDateTime(modifiedDate)} .
  }
  WHERE {
    ${sparqlEscapeUri(agendaURI)} a besluitvorming:Agenda ;
      dct:modified ?oldModified ;
      besluitvorming:agendaStatus ?oldAgendaStatus .
  }`;
  return await mu.update(query);

}

export {
  getAgendaURI,
  selectAgendaitems,
  selectApprovedAgendaitemsNotFormallyOk,
  selectNewAgendaitemsNotFormallyOk,
  selectAgendaitemsForSorting,
  setAgendaStatusApproved,
  setAgendaStatusClosed,
  setAgendaStatusDesign,
};
