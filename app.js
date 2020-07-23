// VIRTUOSO bug: https://github.com/openlink/virtuoso-opensource/issues/515
import mu from 'mu';
import { ok } from 'assert';
import cors from 'cors';

const app = mu.app;
const moment = require('moment');
const bodyParser = require('body-parser');
const repository = require('./repository');
const util = require('./util');
const originalQuery = mu.query;

const AGENDA_STATUS_APPROVED = {
  uri: 'http://kanselarij.vo.data.gift/id/agendastatus/ff0539e6-3e63-450b-a9b7-cc6463a0d3d1',
  readable: 'Goedgekeurd',
};


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
app.use(bodyParser.json({ type: 'application/*+json' }));

// Approve agenda route
app.post('/approveAgenda', async (req, res) => {
  const oldAgendaId = req.body.oldAgendaId;
  const oldAgendaURI = await repository.getAgendaURI(oldAgendaId);
  // Create new agenda via query.
  const [newAgendaId, newAgendaURI] = await repository.createNewAgenda(req, res, oldAgendaURI);
  // Copy old agenda data to new agenda.
  const agendaData = await util.copyAgendaItems(oldAgendaURI, newAgendaURI);
  await repository.approveAgenda(oldAgendaURI);
  await repository.storeAgendaItemNumbers(oldAgendaURI);

  res.send({status: ok, statusCode: 200, body: { agendaData: agendaData, newAgenda: { id: newAgendaId, uri: newAgendaURI, data: agendaData } } }); // resultsOfSerialNumbers: resultsAfterUpdates
});

app.post('/onlyApprove', async (req,res) => {
  const idOfAgendaToApprove = req.body.idOfAgendaToApprove;
  if(!idOfAgendaToApprove) {
    res.send({ status: 400, body: { exception: 'Bad request, idOfAgendaToApprove is null'}});
  }
  const uriOfAgendaToApprove = await repository.getAgendaURI(idOfAgendaToApprove);
  if(!uriOfAgendaToApprove) {
    res.send({ status: 400, body: { exception: `Not Found, uri of agenda with ID ${idOfAgendaToApprove} was not found in the database`}});
  }

  await repository.approveAgenda(uriOfAgendaToApprove);
  res.send({ status: ok, statusCode: 200, body: {idOfAgendaThatIsApproved: idOfAgendaToApprove, agendaStatus: AGENDA_STATUS_APPROVED}});
});

mu.app.use(mu.errorHandler);

// Approve agenda route
app.post('/deleteAgenda', async (req, res) => {
  const agendaToDeleteId = req.body.agendaToDeleteId;
  if(!agendaToDeleteId){
    res.send({statusCode: 400, body: "agendaToDeleteId missing, deletion of agenda failed"});
    return;
  }
  try {
    const agendaToDeleteURI = await repository.getAgendaURI(agendaToDeleteId);
    await repository.deleteAgendaActivities(agendaToDeleteURI);
    await repository.deleteAgendaitems(agendaToDeleteURI);
    await repository.deleteAgenda(agendaToDeleteURI);
    res.send({status: ok, statusCode: 200 });
  } catch (e) {
    console.log(e);
    res.send({statusCode: 500, body: "something went wrong while deleting the agenda", e});
  }
});
