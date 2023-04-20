import mu, {
  sparqlEscapeDateTime,
  sparqlEscapeString,
  sparqlEscapeUri,
  uuid
} from 'mu';
import * as util from '../util/index';

const AGENDA_STATUS_DESIGN = 'http://themis.vlaanderen.be/id/concept/agenda-status/b3d8a99b-0a7e-419e-8474-4b508fa7ab91';
const AGENDA_STATUS_APPROVED = 'http://themis.vlaanderen.be/id/concept/agenda-status/fff6627e-4c96-4be1-b483-8fefcc6523ca';
const AGENDAITEM_FORMALLY_OK = 'http://kanselarij.vo.data.gift/id/concept/goedkeurings-statussen/CC12A7DB-A73A-4589-9D53-F3C2F4A40636';

const AGENDA_STATUS_ACTIVITY_RESOURCE_BASE = 'http://themis.vlaanderen.be/id/agenda-status-activiteit/';

const getAgendaURI = async (agendaId) => {
  const query = `
   PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
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

  SELECT DISTINCT ?agendaitem ?number ?type
  WHERE {
      ${sparqlEscapeUri(agendaURI)} dct:hasPart ?agendaitem .
      ?agendaitem a besluit:Agendapunt ;
        schema:position ?number ;
        dct:type ?type .
  } ORDER BY ?type ?number
  `;
  const result = await mu.query(query);
  return util.parseSparqlResults(result);
};

const setAgendaStatusApproved = async (agendaURI) => {
  return await setAgendaStatus(agendaURI, AGENDA_STATUS_APPROVED);
};

const setAgendaStatusDesign = async (agendaURI) => {
  return await setAgendaStatus(agendaURI, AGENDA_STATUS_DESIGN);
};

const setAgendaStatus = async (agendaURI, statusURI) => {
  const modifiedDate = new Date();
  const agendaStatusActivityId = uuid();
  const agendaStatusActivity = AGENDA_STATUS_ACTIVITY_RESOURCE_BASE + agendaStatusActivityId;
  const query = `
  PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX generiek: <http://data.vlaanderen.be/ns/generiek#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

  DELETE {
    ${sparqlEscapeUri(agendaURI)} besluitvorming:agendaStatus ?oldAgendaStatus ;
      dct:modified ?oldModified .
  }
  INSERT {
    ${sparqlEscapeUri(agendaURI)} besluitvorming:agendaStatus ${sparqlEscapeUri(statusURI)} ;
      dct:modified ${sparqlEscapeDateTime(modifiedDate)} .
    ${sparqlEscapeUri(agendaStatusActivity)} a ext:AgendaStatusActivity ;
      a prov:Activity ;
      mu:uuid ${sparqlEscapeString(agendaStatusActivityId)} ;
      prov:startedAtTime ${sparqlEscapeDateTime(modifiedDate)} ;
      generiek:bewerking ${sparqlEscapeUri(statusURI)} ;
      prov:used ${sparqlEscapeUri(agendaURI)} .
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
  setAgendaStatusDesign,
};
