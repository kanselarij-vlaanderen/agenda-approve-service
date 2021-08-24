import { app, errorHandler } from 'mu';
import { ok } from 'assert';
import bodyParser from 'body-parser';

import * as agendaGeneral from './repository/agenda-general';
import * as meetingGeneral from './repository/meeting-general';
import * as agendaApproval from './repository/approve-agenda';
import * as agendaDeletion from './repository/delete-agenda';

app.use(bodyParser.json({ type: 'application/*+json' }));
// TODO KAS-2452 all frontend validations WHEN an action should be allowed 

// Approve agenda route
app.post('/approveAgenda', async (req, res) => {
  const oldAgendaId = req.body.oldAgendaId;
  const oldAgendaURI = await agendaGeneral.getAgendaURI(oldAgendaId);
  const meetingId = req.body.meetingId;
  // set approved status on oldAgenda
  await agendaGeneral.setAgendaStatusApproved(oldAgendaURI);
  // Create new agenda via query.
  const [newAgendaId, newAgendaURI] = await agendaApproval.createNewAgenda(meetingId, oldAgendaURI);
  // Copy old agenda data to new agenda.
  await agendaApproval.copyAgendaItems(oldAgendaURI, newAgendaURI);
  // await agendaApproval.storeAgendaItemNumbers(oldAgendaURI); // TODO: document what this is for. Otherwise remove.

  // TODO KAS-2452 frontend code to implement POST approve
  /*
  actions on approved agenda:
  - new agendaitems that were not formally OK have to be removed
  - recurring agendaitems that were not formally OK have to be rolled back
  - agendaitems have to be sorted to fix gaps in numbering (only if there were new agendaitems that have been deleted)
  actions on new agenda:
  - new agendaitems have to be resorted to the bottom of the lists (approval and nota separately)
  what to return ?
  */

  // on the approved agenda, enforce the formally ok rules (remove new items, rollback approved items, resort agendaitems)
  const countOfAgendaitem = await agendaApproval.enforceFormalOkRules(oldAgendaURI);

  // on the new agenda, sort the new agendaitems to the bottom of the list (those that were not formally ok) and resort the agenda
  if (countOfAgendaitem) {
    await agendaApproval.sortNewAgenda(newAgendaURI);
  }

  res.send({status: ok, statusCode: 200, body: { newAgenda: { id: newAgendaId }}});
});

app.post('/approveAgendaAndCloseMeeting', async (req, res) => {
  const meetingId = req.body.meetingId;
  const agendaId = req.body.agendaId;
  console.log('**** req ****', req);
  console.log('**** res ****', res);
  const meetingURI = await meetingGeneral.getMeetingURI(meetingId);
  const agendaURI = await agendaGeneral.getAgendaURI(agendaId);
  // set closed status on old agenda
  await agendaGeneral.setAgendaStatusClosed(agendaURI);
  // close the meeting
  await meetingGeneral.closeMeeting(meetingURI, agendaURI);
  // on the approved agenda, enforce the formally ok rules
  await agendaApproval.enforceFormalOkRules(agendaId);
  // TODO KAS-2452 frontend code to implement for approve & close
  /*
  actions on design agenda
  - set the closed status (modified date?)
  actions on meeting:
  - set ext:finaleZittingVersie to true
  - set the besluitvorming:behandelt to the approved agenda (first delete other similar relations to enforce one-to-one?)
  */
  /*
  actions on approved agenda:
  - recurring agendaitems that were not formally OK have to be rolled back
  - new agendaitems that were not formally OK have to be removed (cleanup similar to delete agenda)
  - agendaitems have to be sorted to fix gaps in numbering (only if there were new agendaitems that have been deleted)
  TODO what to return ?
  */
  res.send({status: ok, statusCode: 200});
});

app.post('/closeMeeting', async (req, res) => {
  // should only be reachable if there is at least 1 approved agenda, do we want to check this here ?
  const meetingId = req.body.meetingId;
  const meetingURI = await meetingGeneral.getMeetingURI(meetingId);

  // const [lastApprovedAgendaURI, designAgendaURI] = await meetingGeneral.getLatestAgendas(meetingURI);

  const designAgendaURI = await meetingGeneral.getDesignAgenda(meetingURI);
  const [lastApprovedAgendaId, lastApprovedAgendaURI] = await meetingGeneral.getLastApprovedAgenda(meetingURI);
  // set closed status on last agenda
  await agendaGeneral.setAgendaStatusClosed(lastApprovedAgendaURI);
  // close the meeting
  await meetingGeneral.closeMeeting(meetingURI, lastApprovedAgendaURI);

  if (designAgendaURI) {
    console.log('************* Deleting design agenda ******************');
    await agendaDeletion.cleanupNewAgendaitems(designAgendaURI);
    await agendaDeletion.deleteAgendaitems(designAgendaURI);
    await agendaDeletion.deleteAgenda(designAgendaURI); 
  }
  // TODO KAS-2452 frontend code to implement for close
  /*
  actions on last approved agenda (search or parameter?): (is it possible there is none ?)
  - set the closed status (modified date?)
  actions on meeting:
  - set ext:finaleZittingVersie to true
  - set the besluitvorming:behandelt to the last approved agenda (first delete other similar relations to enforce one-to-one?)

  - remove the design agenda (full deleteAgenda flow?)
  return id of previous agenda to navigate in frontend? doesnt really make sense for this method but is needed to reduce frontend logic
  */
  setTimeout(() => {
    res.send({status: ok, statusCode: 200, body: { lastApprovedAgenda: { id: lastApprovedAgendaId }}});
  }, 15000);
});

app.post('/reopenPreviousAgenda', async (req, res) => {
  // should only be reachable if there is at least 1 approved agenda, do we want to check this here ?
  const meetingId = req.body.meetingId; // agenda or meeting id ? should always be initiated from design agenda
  const meetingURI = await meetingGeneral.getMeetingURI(meetingId);

  const designAgendaURI = await meetingGeneral.getDesignAgenda(meetingURI);
  const [lastApprovedAgendaId, lastApprovedAgendaURI] = await meetingGeneral.getLastApprovedAgenda(meetingURI);

  await agendaGeneral.setAgendaStatusDesign(lastApprovedAgendaURI);

  // current frontend checks only allow this action if design agenda is present
  if (designAgendaURI) {
    await agendaDeletion.cleanupNewAgendaitems(designAgendaURI);
    await agendaDeletion.deleteAgendaitems(designAgendaURI);
    await agendaDeletion.deleteAgenda(designAgendaURI); 
  }

  // TODO KAS-2452 frontend code to implement reopenPrevious
  /*
  actions on last approved agenda (search or parameter?): (is it possible there is none ?)
  - set the design status (modified date)
  actions on meeting:
  TODO KAS-2452 do we need to change besluitvorming:behandelt here? regular approving does not change/insert this relation, resulting in stale data until closing of the agenda
  - set the besluitvorming:behandelt to the last approved agenda (first delete other similar relations to enforce one-to-one?)
  - delete all NEW pieces & files of the approved agendaitems (to remove inconsistencies with subcase), keep pieces of new agendaitems (because they can be proposed to new agenda)
  - remove the design agenda (full deleteAgenda flow?)
  return id of previous agenda to navigate in frontend? doesnt really make sense for this method but is needed to reduce frontend logic
  */
  res.send({status: ok, statusCode: 200, body: { reopenedAgenda: { id: lastApprovedAgendaId }}});
});

// TODO KAS-2452 api for create new designagenda ?

// Rollback formally not ok agendaitems route
// TODO KAS-2452 DELETE
// app.post('/rollbackAgendaitemsNotFormallyOk', async (req, res) => {
//   const oldAgendaId = req.body.oldAgendaId;
//   const oldAgendaURI = await agendaGeneral.getAgendaURI(oldAgendaId);
//   // Rollback agendaitems that were not approvable on the agenda.
//  await agendaApproval.rollbackAgendaitems(oldAgendaURI);
//  setTimeout(() => {
//     // TODO This timeout is a cheesy way to ensure cache was reloaded before sending our response
//     // Reason for this: frontend reloads yielded stale data right after this api call and the next save would save that stale data
//     res.send({status: ok, statusCode: 200 });
//   }, 2000);
// });

app.use(errorHandler);

app.post('/deleteAgenda', async (req, res) => {
  const agendaToDeleteId = req.body.agendaToDeleteId;
  if(!agendaToDeleteId){
    res.send({statusCode: 400, body: "agendaToDeleteId missing, deletion of agenda failed"});
    return;
  }
  try {
    // TODO KAS-2452 frontend code to implement PRE delete
    /*
    - On the linked meeting, link the besluitvorming:behandelt to the previous agenda (what if it doesn't exist ?)
    */
    const agendaToDeleteURI = await agendaGeneral.getAgendaURI(agendaToDeleteId);
    await agendaDeletion.cleanupNewAgendaitems(agendaToDeleteURI);
    await agendaDeletion.deleteAgendaitems(agendaToDeleteURI);
    await agendaDeletion.deleteAgenda(agendaToDeleteURI);
    // TODO KAS-2452 frontend code to implement POST delete
    /*
    - If there is a previous agenda, do nothing (or should we return the id, so we can use it to navigate)
    - If there isn't, also remove the session (better here then in frontend ?)
    */
    res.send({status: ok, statusCode: 200 });
  } catch (e) {
    console.log(e);
    res.send({statusCode: 500, body: "something went wrong while deleting the agenda", e});
  }
});
