import { app, errorHandler } from 'mu';
import { ok } from 'assert';
import bodyParser from 'body-parser';

import { getAgendaURI } from './repository/agenda-general';
import * as agendaApproval from './repository/approve-agenda';
import * as agendaDeletion from './repository/delete-agenda';

app.use(bodyParser.json({ type: 'application/*+json' }));

// Approve agenda route
app.post('/approveAgenda', async (req, res) => {
  const oldAgendaId = req.body.oldAgendaId;
  const oldAgendaURI = await getAgendaURI(oldAgendaId);
  // Create new agenda via query.
  const [newAgendaId, newAgendaURI] = await agendaApproval.createNewAgenda(req, res, oldAgendaURI);
  // Copy old agenda data to new agenda.
  const agendaData = await agendaApproval.copyAgendaItems(oldAgendaURI, newAgendaURI);
  await agendaApproval.storeAgendaItemNumbers(oldAgendaURI); // TODO: document what this is for. Otherwise remove.

  res.send({status: ok, statusCode: 200, body: { agendaData: agendaData, newAgenda: { id: newAgendaId, uri: newAgendaURI, data: agendaData } } }); // resultsOfSerialNumbers: resultsAfterUpdates
});

// Rollback formally not ok agendaitems route
app.post('/rollbackAgendaitemsNotFormallyOk', async (req, res) => {
  const oldAgendaId = req.body.oldAgendaId;
  const oldAgendaURI = await getAgendaURI(oldAgendaId);
  // Rollback agendaitems that were not approvable on the agenda.
 await agendaApproval.rollbackAgendaitems(oldAgendaURI);
 setTimeout(() => {
    // TODO This timeout is a cheesy way to ensure cache was reloaded before sending our response
    // Reason for this: frontend reloads yielded stale data right after this api call and the next save would save that stale data
    res.send({status: ok, statusCode: 200 });
  }, 2000);
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
    await agendaDeletion.cleanupNewAgendaitems(agendaToDeleteURI);
    await agendaDeletion.deleteAgendaitems(agendaToDeleteURI);
    await agendaDeletion.deleteAgenda(agendaToDeleteURI);
    res.send({status: ok, statusCode: 200 });
  } catch (e) {
    console.log(e);
    res.send({statusCode: 500, body: "something went wrong while deleting the agenda", e});
  }
});
