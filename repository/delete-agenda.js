import mu, { sparqlEscapeUri } from 'mu';
import { selectAgendaItems } from './agenda-general';

const targetGraph = 'http://mu.semte.ch/application';

/**
 * Deletes agendaitems for a specific agenda
 * @name deleteAgendaitems
 * @function
 * @param {String} deleteAgendaURI - The URI of the agenda to delete the agendaitems from
 */
const deleteAgendaitems = async (deleteAgendaURI) => {
  const agendaItemUrisQueryResult = await selectAgendaItems(deleteAgendaURI);
  const listOfAgendaItemUris = agendaItemUrisQueryResult.map(uri => uri.agendaitem);

  for (const agendaItemUri of listOfAgendaItemUris) {
    await deleteAgendaitem(deleteAgendaURI, agendaItemUri);
  }
};

/**
 * Deletes the relations and its content of an agendaItem.
 * @description This function will delete all predicates that are related to agendaitem.
 * @name deleteAgendaitem
 * @function
 * @param {String} deleteAgendaURI - The URI of the agenda
 * @param {String} agendaitemUri - The URI of the agendaitem which is the startpoint
 */
const deleteAgendaitem = async (deleteAgendaURI, agendaItemUri) => {
  const query = `
  PREFIX dct: <http://purl.org/dc/terms/>

  DELETE {
    GRAPH <${targetGraph}>  {
    ${sparqlEscapeUri(agendaItemUri)} ?p ?o .
    ?s ?pp ${sparqlEscapeUri(agendaItemUri)} .
  }
  } WHERE {
    GRAPH <${targetGraph}> { 
    ${sparqlEscapeUri(agendaItemUri)} ?p ?o .
    ?s ?pp ${sparqlEscapeUri(agendaItemUri)} .
    }
  }`;
  await mu.query(query);
};

const deleteAgendaActivities = async (deleteAgendaURI) => {
  const query = `
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>

  DELETE {
    GRAPH <${targetGraph}> {
    ?subcase besluitvorming:isAangevraagdVoor ?session .
    ?activity a besluitvorming:Agendering .
    ?activity besluitvorming:vindtPlaatsTijdens ?subcase .
    ?activity besluitvorming:genereertAgendapunt ?agendapunt . 
    ?activity ?p ?o .
    }
  }
  
 WHERE {
    GRAPH <${targetGraph}> {

    ?subcase a dbpedia:UnitOfWork .
    OPTIONAL { ?subcase besluitvorming:isAangevraagdVoor ?session .}
    OPTIONAL { 
      ?activity besluitvorming:genereertAgendapunt ?agendapunt .
      ?activity a besluitvorming:Agendering .
      ?activity ?p ?o . 
    }
    
      FILTER (?totalitems = 1)  {

        SELECT (count(*) AS ?totalitems) ?subcase ?activity WHERE {
          GRAPH <${targetGraph}> {
            ${sparqlEscapeUri(deleteAgendaURI)} dct:hasPart ?agendaitems .

            ?subcase a dbpedia:UnitOfWork . 
            ?activity a besluitvorming:Agendering .
            ?activity besluitvorming:vindtPlaatsTijdens ?subcase .
            ?activity besluitvorming:genereertAgendapunt ?agendaitems . 
            ?activity besluitvorming:genereertAgendapunt ?totalitems . 
          }
        }
        GROUP BY ?subcase ?activity
      }
       
    }
  }
  `;
  await mu.query(query);
};

const deleteAgenda = async (deleteAgendaURI) => {
  const query = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>

  DELETE {
    GRAPH <${targetGraph}>  {
    ${sparqlEscapeUri(deleteAgendaURI)} ?p ?o .
    ?s ?pp ${sparqlEscapeUri(deleteAgendaURI)} .
  }
  } WHERE {
    GRAPH <${targetGraph}> { 
    ${sparqlEscapeUri(deleteAgendaURI)} a besluitvorming:Agenda ;
      ?p ?o .
      OPTIONAL {
        ?s ?pp ${sparqlEscapeUri(deleteAgendaURI)} .
      }
    }
  }`;
  await mu.query(query);
};

export {
  deleteAgendaitems,
  deleteAgendaActivities,
  deleteAgenda
};
