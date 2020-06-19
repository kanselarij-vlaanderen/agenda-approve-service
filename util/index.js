const repository = require('./../repository/index.js');
const targetGraph = "http://mu.semte.ch/application";
const batchSize = process.env.BATCH_SIZE || 100;
const moment = require('moment');
import mu from 'mu';

function getBindingValue(binding, property, fallback) {
  binding = binding || {};
  const result = (binding[property] || {}).value;
  if (typeof result === "undefined") {
    return fallback;
  }
  return result;
}

const updatePropertiesOnAgendaItems = async function (agendaUri) {
  const selectTargets = `  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dct: <http://purl.org/dc/terms/>
  SELECT DISTINCT ?target WHERE {
    <${agendaUri}> dct:hasPart ?target .
    ?target ext:replacesPrevious ?previousURI .
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
  const movePropertiesLeft = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>

  INSERT { 
    GRAPH <${targetGraph}> {
      ?target ?p ?o .
    }
  } WHERE {
    VALUES (?target) {
      (<${targets.join(">) (<")}>)
    }
    ?target ext:replacesPrevious ?previousURI .
    ?previousURI ?p ?o .
    FILTER(?p != mu:uuid)
  }`;
  await mu.update(movePropertiesLeft);

  const movePropertiesRight = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>

  INSERT { 
    GRAPH <${targetGraph}> {
      ?o ?p ?target .
    }
  } WHERE {
    VALUES (?target) {
      (<${targets.join(">) (<")}>)
    }
    ?target ext:replacesPrevious ?previousURI .
    ?o ?p ?previousURI .
    FILTER(?p != dct:hasPart)
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
  // The bind of ?uuid is a workaround to get a unique id for each STRUUID call.
  // SUBQUERY: Is needed to make sure we have the same UUID for the URI, since using ?uuid generated a new one
  const createNewUris = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dct: <http://purl.org/dc/terms/>

  INSERT { 
    GRAPH <${targetGraph}> {
        ?newAgendaitemURI a besluit:Agendapunt ;
        mu:uuid ?newAgendaitemUuid ;
        ext:replacesPrevious ?agendaitem .
      <${newAgendaUri}> dct:hasPart ?newAgendaitemURI .
    }
  } WHERE { { SELECT * WHERE {
    <${oldAgendaUri}> dct:hasPart ?agendaitem .

    OPTIONAL { ?agendaitem mu:uuid ?olduuid . } 
    BIND(IF(BOUND(?olduuid), STRUUID(), STRUUID()) as ?uuid)
    BIND(IRI(CONCAT("http://kanselarij.vo.data.gift/id/agendapunten/", ?uuid)) AS ?newAgendaitemURI)
    } }
    BIND(STRAFTER(STR(?newAgendaitemURI), "http://kanselarij.vo.data.gift/id/agendapunten/") AS ?newAgendaitemUuid) 
  }`;

  const result = await mu.update(createNewUris);
  return updatePropertiesOnAgendaItems(newAgendaUri);
};

module.exports = {
  updatePropertiesOnAgendaItems,
  copyAgendaItems
};