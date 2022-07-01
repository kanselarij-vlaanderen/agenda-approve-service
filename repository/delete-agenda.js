import mu, { sparqlEscapeUri } from 'mu';
import { selectAgendaitems } from './agenda-general';
import * as util from '../util/index';

/**
 * Deletes agendaitems for a specific agenda
 * @name deleteAgendaitems
 * @function
 * @param {String} deleteAgendaURI - The URI of the agenda to delete the agendaitems from
 */
const deleteAgendaitems = async (deleteAgendaURI) => {
  const listOfAgendaitemUris = await selectAgendaitems(deleteAgendaURI);

  for (const agendaitemUri of listOfAgendaitemUris) {
    await deleteAgendaitem(agendaitemUri);
  }
};

/**
 * Deletes the relations and its content of an agendaitem.
 * @description This function will delete all predicates that are related to agendaitem.
 * @name deleteAgendaitem
 * @function
 * @param {String} agendaitemUri - The URI of the agendaitem which is the startpoint
 */
const deleteAgendaitem = async (agendaitemUri) => {
  const query = `
  DELETE {
    ${sparqlEscapeUri(agendaitemUri)} ?p ?o .
    ?s ?pp ${sparqlEscapeUri(agendaitemUri)} .
  } WHERE {
    ${sparqlEscapeUri(agendaitemUri)} ?p ?o .
    ?s ?pp ${sparqlEscapeUri(agendaitemUri)} .
  }`;
  await mu.update(query);
};

/**
 * @description This function will delete all predicates of a newsletter that is linked to the agendaitem. 
 * @name deleteAgendaitemNewsletterInfo
 * @function
 * @param {String} agendaitemUri - The URI of the agendaitem which is the startpoint
 */
const deleteAgendaitemNewsletterInfo = async (agendaitemUri) => {
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX prov: <http://www.w3.org/ns/prov#>

  DELETE {
    ?newsletter ?p ?o .
  }
  
  WHERE {
    ?treatment besluitvorming:heeftOnderwerp ${sparqlEscapeUri(agendaitemUri)} .
    ?treatment a besluit:BehandelingVanAgendapunt .
    OPTIONAL {
      ?treatment prov:generated ?newsletter .
      ?newsletter a besluitvorming:NieuwsbriefInfo .
      ?newsletter ?p ?o .
    }
  }`;
  await mu.update(query);
};


/**
 * @description This function will delete all predicates of decidionActivity that are linked to the agendaitem treatment. 
 * @name deleteAgendaitemDecisionActivity
 * @function
 * @param {String} agendaitemUri - The URI of the agendaitem which is the startpoint
 */
 const deleteAgendaitemDecisionActivity = async (agendaitemUri) => {
  // *NOTE* there are 3 inverse relations to the report, publication-flows and sign-flows.
  // not deleting them because we can assume that this delete would not be called if any of those are present
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>

  DELETE {
    ?decisionActivity ?p ?o .
  }
  
  WHERE {
    ?decisionActivity ^besluitvorming:heeftBeslissing/besluitvorming:heeftOnderwerp ${sparqlEscapeUri(agendaitemUri)} .
    ?decisionActivity a besluitvorming:Beslissingsactiviteit .
    ?decisionActivity ?p ?o .
  }`;
  console.log('query', query)
  await mu.update(query);
};

/**
 * @description This function will delete all predicates of treatments that are linked to the agendaitem. 
 * @name deleteAgendaitemTreatments
 * @function
 * @param {String} agendaitemUri - The URI of the agendaitem which is the startpoint
 */
const deleteAgendaitemTreatments = async (agendaitemUri) => {
  const query = `
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>

  DELETE {
    ?treatment ?p ?o .
  }
  
  WHERE {
    ?treatment besluitvorming:heeftOnderwerp ${sparqlEscapeUri(agendaitemUri)} .
    ?treatment a besluit:BehandelingVanAgendapunt .
    ?treatment ?p ?o .
  }`;
  await mu.update(query);
};

/**
 * @description This function will delete the agenda-activity that is linked to the agendaitem.
 * Also deletes the relation between the meeting and the subcase.
 * @name deleteAgendaActivity
 * @function
 * @param {String} agendaitemUri - The URI of the agendaitem which is the startpoint
 */
const deleteAgendaActivity = async (agendaitemUri) => {
  const query = `
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>

  DELETE {
    ?subcase ext:isAangevraagdVoor ?meeting .
    ?activity a besluitvorming:Agendering .
    ?activity besluitvorming:vindtPlaatsTijdens ?subcase .
    ?activity besluitvorming:genereertAgendapunt ${sparqlEscapeUri(agendaitemUri)} . 
    ?activity ?p ?o .
  }
  WHERE {
    ?subcase a dossier:Procedurestap .
    OPTIONAL { ?subcase ext:isAangevraagdVoor ?meeting  .}
    ?activity a besluitvorming:Agendering .
    ?activity besluitvorming:vindtPlaatsTijdens ?subcase .
    ?activity besluitvorming:genereertAgendapunt ${sparqlEscapeUri(agendaitemUri)} .
    ?activity ?p ?o .
  }`;
  await mu.update(query);
};

/** 
 * @description This function will check for each agendaitem on the agenda how many agendaitems are connected to the agenda-activity
 * - If there is exactly 1 agendaitem = clean up the data so subcase is proposable again:
 * newsletters linked to linked treatments
 * linked treatments
 * deleting the agenda-activity / link between meeting and subcase
 * - If there is 0 or more than 1 = do nothing with those agendaitems (0 can be approval, 2 means there is an agendaitem on an approved agenda)
 * @name cleanupNewAgendaitems
 * @function
 * @param {String} deleteAgendaURI - The URI of the agenda
 */
const cleanupNewAgendaitems = async (deleteAgendaURI) => {
  const selectQuery = `
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>

  SELECT DISTINCT ?agendapunt WHERE {
    ?subcase a dossier:Procedurestap .
    OPTIONAL { ?subcase ext:isAangevraagdVoor ?meeting .}
    OPTIONAL { 
      ?activity besluitvorming:genereertAgendapunt ?agendapunt .
      ?activity a besluitvorming:Agendering .
    }
    FILTER (?totalitems = 1)
    {
      SELECT (count(*) AS ?totalitems) ?subcase ?activity WHERE {
        ${sparqlEscapeUri(deleteAgendaURI)} dct:hasPart ?agendaitems .

        ?subcase a dossier:Procedurestap . 
        ?activity a besluitvorming:Agendering .
        ?activity besluitvorming:vindtPlaatsTijdens ?subcase .
        ?activity besluitvorming:genereertAgendapunt ?agendaitems . 
        ?activity besluitvorming:genereertAgendapunt ?totalitems . 
      } GROUP BY ?subcase ?activity
    }
  }
  `;
  const result = await mu.query(selectQuery);
  const targetAgendaitems = util.parseSparqlResults(result);
  console.log(`##### Found ${targetAgendaitems.length} agendaitem(s) that need extra cleanup #####`);
  const listOfAgendaitemUris = targetAgendaitems.map(uri => uri.agendapunt);

  for (const agendaitemUri of listOfAgendaitemUris) {
    await deleteAgendaitemNewsletterInfo(agendaitemUri);
    await deleteAgendaitemDecisionActivity(agendaitemUri);
    await deleteAgendaitemTreatments(agendaitemUri);
    await deleteAgendaActivity(agendaitemUri);
  }
}

const deleteAgenda = async (deleteAgendaURI) => {
  const query = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>

  DELETE {
    ${sparqlEscapeUri(deleteAgendaURI)} ?p ?o .
    ?s ?pp ${sparqlEscapeUri(deleteAgendaURI)} .
  } WHERE {
    ${sparqlEscapeUri(deleteAgendaURI)} a besluitvorming:Agenda ;
      ?p ?o .
      OPTIONAL {
        ?s ?pp ${sparqlEscapeUri(deleteAgendaURI)} .
      }
  }`;
  await mu.update(query);
};

/*
  The reason for the use of sleep is due to a "bug" in mu-cache keys clearing.
  If we execute all DELETE statements after each other, the corresponding keys are not cleared
  If we wait some time (can take between 0.5 and 2.x seconds (or longer?)) then cache cleares happen between deletes
  Specifically causes stale data when a meeting with only an approval agendaitem is deleted
  The delete actions are barely used on production and more during testing, so this workaround is acceptable
*/
const deleteAgendaAndAgendaitems = async (agendaURI) => {
  await cleanupNewAgendaitems(agendaURI);
  await util.sleep();
  await deleteAgendaitems(agendaURI);
  await util.sleep();
  await deleteAgenda(agendaURI);
  await util.sleep();
};

/**
 * @description This method will cleanup all given agendaitems so the connected subcase can be proposed on another agenda
 * *Warning: Use this method only on agendaitems that do not have a next version or some links will be removed
 * @param {[String]} agendaitems - A list of agendaitem URI's
 */
const cleanupAndDeleteNewAgendaitems = async (agendaitems) => {
  for (const agendaitemUri of agendaitems) {
    await deleteAgendaitemNewsletterInfo(agendaitemUri);
    await deleteAgendaitemDecisionActivity(agendaitemUri);
    await deleteAgendaitemTreatments(agendaitemUri);
    await deleteAgendaActivity(agendaitemUri);
    await deleteAgendaitem(agendaitemUri);
  }
}

export {
  deleteAgendaitem,
  deleteAgendaAndAgendaitems,
  cleanupAndDeleteNewAgendaitems,
};
