const repository = require('./../repository');

const targetGraph = "http://mu.semte.ch/graphs/organizations/kanselarij";

function getBindingValue(binding, property, fallback) {
    binding = binding || {};
    const result = (binding[property] || {}).value;
    if (typeof result === "undefined") {
        return fallback;
    }
    return result;
}

const updatePropertiesOnAgendaItemsBatched = async function (agendaUri) {
    const selectTargets = `  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dct: <http://purl.org/dc/terms/>
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
    if (targets.length == 0) {
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


async function nameDocumentsBasedOnAgenda(agendaUri) {
    let response = await repository.getUnnamedDocumentsOfAgenda(agendaUri);
    const mededelingType = "5fdf65f3-0732-4a36-b11c-c69b938c6626";

    let previousAgendaItem = null;
    let previousStartingIndex = 0;
    let triples = [];

    response.results.bindings.map((binding) => {

        const bindingValue = function (property, fallback) {
            return getBindingValue(binding, property, fallback);
        };
        let item = bindingValue('agendaItem');
        let numbersSoFar = parseInt(bindingValue('existingNumbers')) || 0;
        let document = bindingValue('document');
        let number = parseInt(bindingValue('number'));
        let date = moment(bindingValue('zittingDate'));
        let asAnnouncement = bindingValue('announcement', '').indexOf("true") >= 0;
        let type = bindingValue('dossierType', '').indexOf(mededelingType) >= 0 ? "MED" : "DOC";
        if (asAnnouncement) {
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
  };`).catch(err => {
        console.error(err);
    });
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
        return await repository.createNewSubcasesPhase(codeURI, subcaseListOfURIS)
    }
}




module.exports = {
    checkForPhasesAndAssignMissingPhases,
};