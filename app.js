import { app, errorHandler } from 'mu';
import { ok } from 'assert';
import bodyParser from 'body-parser';

import { getAgendaURI } from './repository/agenda-general';
import * as agendaApproval from './repository/approve-agenda';
import * as agendaDeletion from './repository/delete-agenda';

const AGENDA_STATUS_APPROVED = {
  uri: 'http://kanselarij.vo.data.gift/id/agendastatus/ff0539e6-3e63-450b-a9b7-cc6463a0d3d1',
  readable: 'Goedgekeurd',
};

app.use(bodyParser.json({ type: 'application/*+json' }));

// Approve agenda route
app.post('/approveAgenda', async (req, res) => {
  const oldAgendaId = req.body.oldAgendaId;
  const oldAgendaURI = await getAgendaURI(oldAgendaId);
  // Create new agenda via query.
  const [newAgendaId, newAgendaURI] = await agendaApproval.createNewAgenda(req, res, oldAgendaURI);
  // Copy old agenda data to new agenda.
  const agendaData = await agendaApproval.copyAgendaItems(oldAgendaURI, newAgendaURI);
  await agendaApproval.approveAgenda(oldAgendaURI);
  await agendaApproval.storeAgendaItemNumbers(oldAgendaURI);

  res.send({status: ok, statusCode: 200, body: { agendaData: agendaData, newAgenda: { id: newAgendaId, uri: newAgendaURI, data: agendaData } } }); // resultsOfSerialNumbers: resultsAfterUpdates
});

// TODO: The functionality of this route can be replaced by a resources-call. Refactor out.
app.post('/onlyApprove', async (req,res) => {
  const idOfAgendaToApprove = req.body.idOfAgendaToApprove;
  if(!idOfAgendaToApprove) {
    res.send({ status: 400, body: { exception: 'Bad request, idOfAgendaToApprove is null'}});
  }
  const uriOfAgendaToApprove = await getAgendaURI(idOfAgendaToApprove);
  if(!uriOfAgendaToApprove) {
    res.send({ status: 400, body: { exception: `Not Found, uri of agenda with ID ${idOfAgendaToApprove} was not found in the database`}});
  }

  await agendaApproval.approveAgenda(uriOfAgendaToApprove);
  res.send({ status: ok, statusCode: 200, body: {idOfAgendaThatIsApproved: idOfAgendaToApprove, agendaStatus: AGENDA_STATUS_APPROVED}});
});

app.use(errorHandler);

app.post('/deleteAgenda', async (req, res) => {
  const agendaToDeleteId = req.body.agendaToDeleteId;
  if(!agendaToDeleteId){
    res.send({statusCode: 400, body: "agendaToDeleteId missing, deletion of agenda failed"});
    return;
  }
  try {
    const agendaToDeleteURI = await getAgendaURI(agendaToDeleteId);
    await agendaDeletion.deleteAgendaActivities(agendaToDeleteURI);
    await agendaDeletion.deleteAgendaitems(agendaToDeleteURI);
    await agendaDeletion.deleteAgenda(agendaToDeleteURI);
    res.send({status: ok, statusCode: 200 });
  } catch (e) {
    console.log(e);
    res.send({statusCode: 500, body: "something went wrong while deleting the agenda", e});
  }
});
