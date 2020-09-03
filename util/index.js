import mu from 'mu';
import { sparqlEscapeUri, sparqlEscapeDateTime, uuid as generateUuid, sparqlEscapeString } from 'mu';
const repository = require('./../repository/index.js');
const targetGraph = "http://mu.semte.ch/application";
const batchSize = process.env.BATCH_SIZE || 100;

const AGENDA_ITEM_RESOURCE_BASE = 'http://kanselarij.vo.data.gift/id/agendapunten/';

function getBindingValue(binding, property, fallback) {
  binding = binding || {};
  const result = (binding[property] || {}).value;
  if (typeof result === "undefined") {
    return fallback;
  }
  return result;
}

const updatePropertiesOnAgendaItems = async function (agendaUri) {
  const selectTargets = `
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX dct: <http://purl.org/dc/terms/>

SELECT DISTINCT ?target WHERE {
    ${sparqlEscapeUri(agendaUri)} dct:hasPart ?target .
    ?target prov:wasRevisionOf ?previousURI .
}  
  `;
  const data = await mu.query(selectTargets);
  const targets = data.results.bindings.map((binding) => {
    return binding.target.value;
  });
  return updatePropertiesOnAgendaItemsBatched(targets);
}

const updatePropertiesOnAgendaItemsBatched = async function (targets) {
  if (!targets || targets.length == 0) {
    console.log("all done updating properties of agendaitems");
    return;
  }


  let targetsToDo = [];
  if (targets.length > batchSize) {
    console.log(`Agendaitems list exceeds the batchSize of ${batchSize}, splitting into batches`);
    targetsToDo = targets.splice(0, batchSize);
  }
  const ignoredPropertiesLeft = [
    'http://mu.semte.ch/vocabularies/core/uuid',
    'http://www.w3.org/ns/prov#wasRevisionOf',
    'http://data.vlaanderen.be/ns/besluitvorming#aanmaakdatum' // TODO: not part of besluitvorming namespace
  ];
  const movePropertiesLeft = `
  PREFIX prov: <http://www.w3.org/ns/prov#>

  INSERT { 
    GRAPH <${targetGraph}> {
      ?target ?p ?o .
    }
  } WHERE {
    VALUES (?target) {
      (<${targets.join(">) (<")}>)
    }
    ?target prov:wasRevisionOf ?previousURI .
    ?previousURI ?p ?o .
    FILTER(?p NOT IN (${ignoredPropertiesLeft.map(sparqlEscapeUri).join(', ')}))
  }`;
  await mu.update(movePropertiesLeft);

  const ignoredPropertiesRight = [
    'http://purl.org/dc/terms/hasPart',
    'http://www.w3.org/ns/prov#wasRevisionOf'
  ];
  const movePropertiesRight = `
  PREFIX prov: <http://www.w3.org/ns/prov#>

  INSERT { 
    GRAPH <${targetGraph}> {
      ?o ?p ?target .
    }
  } WHERE {
    VALUES (?target) {
      (<${targets.join(">) (<")}>)
    }
    ?target prov:wasRevisionOf ?previousURI .
    ?o ?p ?previousURI .
    FILTER(?p NOT IN (${ignoredPropertiesRight.map(sparqlEscapeUri).join(', ')}))
  }`;
  await mu.update(movePropertiesRight);

  return updatePropertiesOnAgendaItemsBatched(targetsToDo);
};

const parseSparqlResults = (data) => {
  const vars = data.head.vars;
  return data.results.bindings.map(binding => {
    let obj = {};
    vars.forEach(varKey => {
      if (binding[varKey]) {
        obj[varKey] = binding[varKey].value;
      }
    });
    return obj;
  })
};

const copyAgendaItems = async (oldAgendaUri, newAgendaUri) => {
  const uuid = generateUuid();
  const uri = AGENDA_ITEM_RESOURCE_BASE + uuid;
  const creationDate = new Date();
  const createNewUris = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX dct: <http://purl.org/dc/terms/>

  INSERT { 
    ${sparqlEscapeUri(uri)} a besluit:Agendapunt ;
      mu:uuid ${sparqlEscapeString(uuid)} ;
      besluitvorming:aanmaakdatum ${sparqlEscapeDateTime(creationDate)} ;
      prov:wasRevisionOf ?agendaitem .
    ${sparqlEscapeUri(newAgendaUri)} dct:hasPart ${sparqlEscapeUri(uri)} .
  } WHERE {
    ${sparqlEscapeUri(oldAgendaUri)} dct:hasPart ?agendaitem .
  }`;
  // TODO: "aanmaakdatum" not part of besluitvorming namespace
  const result = await mu.update(createNewUris);
  return updatePropertiesOnAgendaItems(newAgendaUri);
};

module.exports = {
  updatePropertiesOnAgendaItems,
  copyAgendaItems,
  parseSparqlResults
};
