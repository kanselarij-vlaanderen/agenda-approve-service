// VIRTUOSO bug: https://github.com/openlink/virtuoso-opensource/issues/515
import mu from 'mu';
import {ok} from 'assert';
import cors from 'cors';

const app = mu.app;
const moment = require('moment');
const bodyParser = require('body-parser');
const repository = require('./repository');
const util = require('./util');
const originalQuery = mu.query;

const SERVICENAME = 'agenda-approve-service';
const GRAPH = 'http://mu.semte.ch/graphs/public';

const errorLoggingModule = require('error-logging-module');

const logger = new errorLoggingModule();
logger.setGraph(GRAPH);
logger.setServiceName(SERVICENAME);

mu.query = function (query, retryCount = 0) {
    let start = moment();
    return originalQuery(query).catch((error) => {
        if (retryCount < 3) {
            console.log(`error during query ${query}: ${error}`);
            return mu.query(query, retryCount + 1);
        }
        console.log(`final error during query ${query}: ${error}`);
        throw error;
    }).then((result) => {
        console.log(`query took: ${moment().diff(start, 'seconds', true).toFixed(3)}s`);
        return result;
    });
};
mu.update = mu.query;

app.use(cors());
app.use(bodyParser.json({type: 'application/*+json'}));

// Approve agenda route
app.post('/approveAgenda', async (req, res) => {
    const oldAgendaId = req.body.oldAgendaId;
    const oldAgendaURI = await repository.getAgendaURI(oldAgendaId);
    // Create new agenda via query.
    const [newAgendaId, newAgendaURI] = await repository.createNewAgenda(req, res, oldAgendaURI);
    // Copy old agenda data to new agenda.
    const agendaData = await util.copyAgendaItems(oldAgendaURI, newAgendaURI);

    await repository.markAgendaItemsPartOfAgendaA(oldAgendaURI);
    await repository.storeAgendaItemNumbers(oldAgendaURI);

    try {
        const codeURI = await repository.getSubcasePhaseCode();
        const subcasePhasesOfAgenda = await repository.getSubcasePhasesOfAgenda(newAgendaId, codeURI);

        await util.checkForPhasesAndAssignMissingPhases(subcasePhasesOfAgenda, codeURI);
      await originalQuery(logger.createLogEntry({
        type:'INFO',
        state: 'UP'
      }));
    } catch (e) {
        console.log(`error on ${newAgendaURI}`);
        console.log("something went wrong while assigning the code 'Geagendeerd' to the agendaitems", e);
    }


    res.send({status: ok, statusCode: 200, body: {agendaData: agendaData, newAgenda:{id: newAgendaId, uri: newAgendaURI, data:  agendaData}}}); // resultsOfSerialNumbers: resultsAfterUpdates
});

mu.app.use(mu.errorHandler);

// Approve agenda route
app.post('/deleteAgenda', async (req, res) => {
  const agendaToDeleteId = req.body.agendaToDeleteId;
  if(!agendaToDeleteId){
    res.send({statusCode: 400, body: "agendaToDeleteId missing, deletion of agenda failed"});
    return;
  }
  try{
    const agendaToDeleteURI = await repository.getAgendaURI(agendaToDeleteId);
    await repository.deleteSubcasePhases(agendaToDeleteURI);
    await repository.deleteAgendaitems(agendaToDeleteURI);
    await repository.deleteAgenda(agendaToDeleteURI);
    res.send({status: ok, statusCode: 200});
  } catch (e) {
      console.log(e);
    res.send({statusCode: 500, body: "something went wrong while deleting the agenda", e});
  }
});

app.get('/health', async (req,res) => {
  await originalQuery(logger.createLogEntry({
    type:'INFO',
    state: 'UP'
  }));
  res.send({status: ok, statusCode: 200});
});
