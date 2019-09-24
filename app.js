// VIRTUOSO bug: https://github.com/openlink/virtuoso-opensource/issues/515
import mu from 'mu';
import { ok } from 'assert';
import cors from 'cors';
const uuidv4 = require('uuid/v4');
const targetGraph = "http://mu.semte.ch/graphs/organizations/kanselarij";

const app = mu.app;
const moment = require('moment');
const bodyParser = require('body-parser');
const originalQuery = mu.query;
const batchSize = process.env.BATCH_SIZE || 100;

mu.query = function(query) {
  let start = moment();
  return originalQuery(query).catch((error) => {
    console.log(`error during query ${query}: ${error}`);
    throw error;
  }).then((result) => {
    console.log(`query took: ${moment().diff(start, 'seconds', true).toFixed(3)}s`);
    return result;
  });
};
mu.update = mu.query;

app.use(cors());
app.use(bodyParser.json({ type: 'application/*+json' }));

app.post('/approveAgenda', async (req, res) => {
  const newAgendaId = req.body.newAgendaId;
  const oldAgendaId = req.body.oldAgendaId;

  const newAgendaURI = await getAgendaURI(newAgendaId);
  const oldAgendaURI = await getAgendaURI(oldAgendaId);
  const agendaData = await copyAgendaItems(oldAgendaURI, newAgendaURI);

  await markAgendaItemsPartOfAgendaA(oldAgendaURI);
  await storeAgendaItemNumbers(oldAgendaURI);
  // await nameDocumentsBasedOnAgenda(oldAgendaURI);

  try {
    const codeURI = await getSubcasePhaseCode();
    const subcasePhasesOfAgenda = await getSubcasePhasesOfAgenda(newAgendaId, codeURI);

    await checkForPhasesAndAssignMissingPhases(subcasePhasesOfAgenda, codeURI);
  } catch (e) {
    console.log("something went wrong while assigning the code 'Geagendeerd' to the agendaitems", e);
  }

  res.send({ status: ok, statusCode: 200, body: { agendaData: agendaData } }); // resultsOfSerialNumbers: resultsAfterUpdates
});

async function getSubcasePhaseCode() {
  const query = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  
  SELECT ?code WHERE {
    GRAPH <${targetGraph}> {
          ?code a ext:ProcedurestapFaseCode ;
                  skos:prefLabel ?label .
                   FILTER(UCASE(?label) = UCASE("geagendeerd"))  
    }
  }
`;
  const data = await mu.query(query).catch(err => { console.error(err) });
  console.log(data);
  return data.results.bindings[0].code.value;
}

async function getSubcasePhasesOfAgenda(newAgendaId, codeURI) {
  const query = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  
  SELECT ?agenda ?agendaitem ?subcase ?phases WHERE {
    GRAPH <${targetGraph}> {
        ?agenda a besluitvorming:Agenda ;
                  mu:uuid "${newAgendaId}" .
        ?agenda   dct:hasPart ?agendaitem .
        ?subcase  besluitvorming:isGeagendeerdVia ?agendaitem .
        OPTIONAL{ 
                  ?subcase ext:subcaseProcedurestapFase ?phases . 
                  ?phases  ext:procedurestapFaseCode <${codeURI}> . 
                }   
    }
  }
`;
  return await mu.query(query).catch(err => { console.error(err) });
}

async function markAgendaItemsPartOfAgendaA(agendaUri) {
  const query = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  
  INSERT {
    GRAPH <${targetGraph}> {
      ?agendaItem ext:partOfFirstAgenda """true"""^^<http://mu.semte.ch/vocabularies/typed-literals/boolean> .
    }
  } WHERE {
    <${agendaUri}> dct:hasPart ?agendaItem .
    
    FILTER NOT EXISTS {
      <${agendaUri}> besluitvorming:heeftVorigeVersie ?o.
    }      
  }`;
  return await mu.query(query).catch(err => { console.error(err) });
}

async function storeAgendaItemNumbers(agendaUri) {
  const maxAgendaItemNumberSoFar = await getHighestAgendaItemNumber(agendaUri);
  let query = `PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  
  SELECT ?agendaItem WHERE {
    <${agendaUri}> dct:hasPart ?agendaItem .
    OPTIONAL {
      ?agendaItem ext:prioriteit ?priority .
    }
    BIND(IF(BOUND(?priority), ?priority, 1000000) AS ?priorityOrMax)
    FILTER NOT EXISTS {
      ?agendaItem ext:agendaItemNumber ?number .
    }
  } ORDER BY ?priorityOrMax`;
  const sortedAgendaItemsToName = await mu.query(query).catch(err => { console.error(err) });
  const triples = [];
  sortedAgendaItemsToName.results.bindings.map((binding, index) => {
    triples.push(`<${binding['agendaItem'].value}> ext:agendaItemNumber ${maxAgendaItemNumberSoFar + index} .`);
  });

  if(triples.length < 1){
    return;
  }

  query = `PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  
  INSERT DATA {
    GRAPH <${targetGraph}> {
      ${triples.join("\n")}
    }
  }`;
  await mu.query(query).catch(err => { console.log(err); })
}

async function getHighestAgendaItemNumber(agendaUri) {
  const query = `PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  
  SELECT (MAX(?number) as ?max) WHERE {
      <${agendaUri}> besluit:isAangemaaktVoor ?zitting .
      ?zitting besluit:geplandeStart ?zittingDate .
      ?otherZitting besluit:geplandeStart ?otherZittingDate .
      FILTER(YEAR(?zittingDate) = YEAR(?otherZittingDate))
      ?otherAgenda besluit:isAangemaaktVoor ?otherZitting .
      ?otherAgenda dct:hasPart ?agendaItem .
      ?agendaItem ext:agendaItemNumber ?number .
  }`;
  const response = await mu.query(query);
  return parseInt(((response.results.bindings[0] || {})['max'] || {}).value || 0);
}

async function getUnnamedDocumentsOfAgenda(agendaUri) {
  const query = `PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  
  SELECT ?agendaItem ?existingNumbers ?document ?number ?zittingDate ?dossierType ?announcement WHERE {
    <${agendaUri}> besluit:isAangemaaktVoor ?zitting .
    ?zitting besluit:geplandeStart ?zittingDate .
    <${agendaUri}> dct:hasPart ?agendaItem .
    ?agendaItem ext:bevatAgendapuntDocumentversie ?documentVersion .
    ?document besluitvorming:heeftVersie ?documentVersion .
    ?agendaItem ext:agendaItemNumber ?number .

    FILTER NOT EXISTS {
      ?document besluitvorming:stuknummerVR ?vrnumber .
    }

    OPTIONAL {
      ?agendaItem ext:wordtGetoondAlsMededeling ?announcement .
    }
    OPTIONAL { 
      ?subcase besluitvorming:isGeagendeerdVia ?agendaItem .
      OPTIONAL {
        ?case dct:hasPart ?subcase .
        ?case dct:type ?dossierType .
      }
    }
    OPTIONAL {
      ?document ext:documentType ?docType .
      ?docType ext:prioriteit ?prio .
    }
    BIND(IF(BOUND(?prio), ?prio, 1000000) AS ?documentPriority)

    { SELECT ?agendaItem (COUNT(DISTINCT(?othervrnumber)) AS ?existingNumbers) WHERE {
        ?agendaItem ext:bevatAgendapuntDocumentversie ?otherVersion .
        ?otherDocument besluitvorming:heeftVersie ?otherVersion .
        OPTIONAL { ?otherDocument besluitvorming:stuknummerVR ?othervrnumber . }
    } GROUP BY ?agendaItem }
    
  } ORDER BY ?agendaItem ?documentPriority
  `;

  return await mu.query(query).catch(err => { console.error(err) });
}

function getBindingValue(binding, property, fallback){
  binding = binding || {};
  const result = (binding[property] || {}).value;
  if(typeof result === "undefined"){
    return fallback;
  }
  return result;
}

async function nameDocumentsBasedOnAgenda(agendaUri) {
  let response = await getUnnamedDocumentsOfAgenda(agendaUri);
  const mededelingType = "5fdf65f3-0732-4a36-b11c-c69b938c6626";

  let previousAgendaItem = null;
  let previousStartingIndex = 0;
  let triples = [];

  response.results.bindings.map((binding) => {

    const bindingValue = function(property, fallback){
      return getBindingValue(binding, property, fallback);
    };
    let item = bindingValue('agendaItem');
    let numbersSoFar = parseInt(bindingValue('existingNumbers')) || 0;
    let document = bindingValue('document');
    let number = parseInt(bindingValue('number'));
    let date = moment(bindingValue('zittingDate'));
    let asAnnouncement = bindingValue('announcement', '').indexOf("true") >= 0;
    let type = bindingValue('dossierType', '').indexOf(mededelingType) >= 0 ? "MED" : "DOC";
    if(asAnnouncement){
      type = "MED";
    }

    if (previousAgendaItem != item) {
      previousAgendaItem = item;
      previousStartingIndex = numbersSoFar;
    }
    previousStartingIndex = previousStartingIndex + 1;
    number = paddNumberWithZeros(number, 4);
    let month = paddNumberWithZeros(date.month(), 2);
    let day = paddNumberWithZeros(date.date(), 2);
    const vrNumber = `"VR ${date.year()} ${month}${day} ${type}.${number}/${previousStartingIndex}"`;
    triples.push(`<${document}> besluitvorming:stuknummerVR ${vrNumber} .`);
    triples.push(`<${document}> ext:stuknummerVROriginal ${vrNumber} .`);
  });

  if (triples.length < 1) {
    return;
  }

  await mu.query(`PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    
  INSERT DATA {
   GRAPH <${targetGraph}> {
          ${triples.join("\n")}
   }
  };`).catch(err => { console.error(err); });
}

function paddNumberWithZeros(number, length) {
  let string = "" + number;
  while (string.length < length) {
    string = 0 + string;
  }
  return string;
}

async function checkForPhasesAndAssignMissingPhases(subcasePhasesOfAgenda, codeURI) {
  if (subcasePhasesOfAgenda) {
    const parsedObjects = parseSparqlResults(subcasePhasesOfAgenda);

    const uniqueSubcaseIds = [...new Set(parsedObjects.map((item) => item['subcase']))];
    let subcaseListOfURIS = [];
    if (uniqueSubcaseIds.length < 1) {
      return;
    }
    await uniqueSubcaseIds.map((id) => {
      const foundObject = parsedObjects.find((item) => item.subcase === id);
      if (foundObject && foundObject.subcase && !foundObject.phases) {
        subcaseListOfURIS.push(foundObject.subcase);
      }
      return id;
    });
    return await createNewSubcasesPhase(codeURI, subcaseListOfURIS)
  }
}

async function createNewSubcasesPhase(codeURI, subcaseListOfURIS) {
  if (subcaseListOfURIS.length < 1) {
    return;
  }
  const listOfQueries = await subcaseListOfURIS.map((subcaseURI) => {
    const newUUID = uuidv4();
    const newURI = `http://data.vlaanderen.be/id/ProcedurestapFase/${newUUID}`;
    return `
    <${newURI}> a   ext:ProcedurestapFase ;
    mu:uuid "${newUUID}" ;
    besluitvorming:statusdatum """${new Date().toISOString()}"""^^xsd:dateTime ;
    ext:procedurestapFaseCode <${codeURI}> .
    <${subcaseURI}> ext:subcaseProcedurestapFase <${newURI}> .
    `
  });

  if(listOfQueries.length < 1){
    return;
  }

  const insertString = listOfQueries.join(' ');
  console.log(insertString);
  const query = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    
  INSERT DATA {
   GRAPH <${targetGraph}> {
          ${insertString}
   }
  };
`;

  return await mu.update(query).catch(err => { console.error(err) });
}

async function getAgendaURI(newAgendaId) {
  const query = `
   PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
   PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
   PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

   SELECT ?agenda WHERE {
    ?agenda a besluitvorming:Agenda ;
    mu:uuid "${newAgendaId}" .
   }
 `;

  const data = await mu.query(query).catch(err => { console.error(err) });
  return data.results.bindings[0].agenda.value;
}

async function copyAgendaItems(oldUri, newUri) {
  // SUBQUERY: Is needed to make sure the uuid isn't generated for every variable.
  const createNewUris = `
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dct: <http://purl.org/dc/terms/>

  INSERT { 
    GRAPH <${targetGraph}> {
      <${newUri}> dct:hasPart ?newURI .
      ?newURI ext:replacesPrevious ?agendaitem .
      <${newUri}> besluitvorming:heeftVorigeVersie <${oldUri}> .
      ?newURI mu:uuid ?newUuid
    }
  } WHERE { { SELECT * WHERE {
    <${oldUri}> dct:hasPart ?agendaitem .

    OPTIONAL { ?agendaitem mu:uuid ?olduuid } 
    BIND(IF(BOUND(?olduuid), STRUUID(), STRUUID()) as ?uuid)
    BIND(IRI(CONCAT("http://kanselarij.vo.data.gift/id/agendapunten/", ?uuid)) AS ?newURI)
    } }
    BIND(STRAFTER(STR(?newURI), "http://kanselarij.vo.data.gift/id/agendapunten/") AS ?newUuid) 
  }`;

  await mu.update(createNewUris);
  return updatePropertiesOnAgendaItemsBatched(newUri);
}

const updatePropertiesOnAgendaItemsBatched = async function(agendaUri){
  const selectTargets = `  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  SELECT ?target WHERE {
    <${agendaUri}> dct:hasPart ?target .
    ?target ext:replacesPrevious ?previousURI.
    FILTER NOT EXISTS {
      ?target a besluit:Agendapunt .
    }
  } LIMIT ${batchSize}
  `;
  const data = await mu.query(selectTargets);
  const targets = data.results.bindings.map((binding) => {
    return binding.target.value;
  });
  if(targets.length == 0){
    return "all done";
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
    ?target ext:replacesPrevious ?previousURI.
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

  return updatePropertiesOnAgendaItemsBatched(agendaUri);
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

mu.app.use(mu.errorHandler);
