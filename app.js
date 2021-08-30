import { app, errorHandler } from 'mu';
import { ok } from 'assert';
import bodyParser from 'body-parser';

import * as agendaGeneral from './repository/agenda-general';
import * as meetingGeneral from './repository/meeting-general';
import * as agendaApproval from './repository/approve-agenda';
import * as agendaDeletion from './repository/delete-agenda';
import * as meetingDeletion from './repository/delete-meeting';

app.use(bodyParser.json({ type: 'application/*+json' }));
app.use(errorHandler);

// TODO KAS-2452 all frontend validations WHEN an action should be allowed 

/**
 * approveAgenda
 * 
 * @param oldAgendaId: id of the agenda to approve
 * @param meetingId: id of the meeting
 * 
 * actions on design agenda:
 * - set the approved status, modified date
 * approving the agenda:
 * - create new agenda
 * - copy the agendaitems (insert new agendaitems, copy left and right triples)
 * actions on approved agenda:
 * - enforce formally ok rules:
 *    - new agendaitems that were not formally OK have to be removed
 *    - recurring agendaitems that were not formally OK have to be rolled back
 *    - agendaitems have to be sorted to fix gaps in numbering (only if there were new agendaitems that have been deleted)
 * actions on new agenda:
 * - new agendaitems have to be resorted to the bottom of the lists (approval and nota separately)
 * @returns the id of the created agenda
 */
app.post('/approveAgenda', async (req, res) => {
  const oldAgendaId = req.body.oldAgendaId;
  const meetingId = req.body.meetingId;
  if(!oldAgendaId || !meetingId){
    res.send({status: "fail", statusCode: 400, error: "agenda or meeting id is missing, approval of agenda failed"});
    return;
  }
  const oldAgendaURI = await agendaGeneral.getAgendaURI(oldAgendaId);
  await agendaGeneral.setAgendaStatusApproved(oldAgendaURI);
  const [newAgendaId, newAgendaURI] = await agendaApproval.createNewAgenda(meetingId, oldAgendaURI);
  await agendaApproval.copyAgendaItems(oldAgendaURI, newAgendaURI);
  // await agendaApproval.storeAgendaItemNumbers(oldAgendaURI); // TODO: document what this is for. Otherwise remove.
  const countOfAgendaitem = await agendaApproval.enforceFormalOkRules(oldAgendaURI);
  if (countOfAgendaitem) {
    await agendaApproval.sortNewAgenda(newAgendaURI);
  }

  res.send({status: ok, statusCode: 200, body: { newAgenda: { id: newAgendaId }}});
});

/**
 * approveAgendaAndCloseMeeting
 * 
 * @param agendaId: id of the agenda to approve
 * @param meetingId: id of the meeting to close
 * 
 * actions on design agenda:
 * - set the closed status, modified date
 * actions on meeting:
 * - set ext:finaleZittingVersie to true
 * - set the besluitvorming:behandelt to the closed agenda
 * actions on closed agenda:
 * - enforce formally ok rules:
 *    - recurring agendaitems that were not formally OK have to be rolled back
 *    - new agendaitems that were not formally OK have to be removed (cleanup similar to delete agenda)
 *    - agendaitems have to be sorted to fix gaps in numbering (only if there were new agendaitems that have been deleted)
 */
app.post('/approveAgendaAndCloseMeeting', async (req, res) => {
  const meetingId = req.body.meetingId;
  const agendaId = req.body.agendaId;
  if(!agendaId || !meetingId){
    res.send({status: "fail", statusCode: 400, error: "agenda or meeting id is missing, approval and closing of agenda failed"});
    return;
  }
  const meetingURI = await meetingGeneral.getMeetingURI(meetingId);
  const agendaURI = await agendaGeneral.getAgendaURI(agendaId);
  await agendaGeneral.setAgendaStatusClosed(agendaURI);
  await meetingGeneral.closeMeeting(meetingURI, agendaURI);
  await agendaApproval.enforceFormalOkRules(agendaURI);

  // We need a small timeout in order for the cache to be cleared by deltas
  setTimeout(() => {
    res.send({status: ok, statusCode: 200});
  }, 1500);
});

/**
 * closeMeeting
 * 
 * @param meetingId: id of the meeting to close
 * 
 * actions on last approved agenda:
 * - set the closed status, modified date
 * actions on meeting:
 * - set ext:finaleZittingVersie to true
 * - set the besluitvorming:behandelt to the last approved agenda
 * remove the design agenda (if any)
 * @returns the id of the last approved agenda
 */
app.post('/closeMeeting', async (req, res) => {
  // TODO KAS-2452 should only be reachable if there is at least 1 approved agenda, do we want to check this here ?
  const meetingId = req.body.meetingId;
  if(!meetingId){
    res.send({status: "fail", statusCode: 400, error: "meeting id is missing, closing of meeting failed"});
    return;
  }
  const meetingURI = await meetingGeneral.getMeetingURI(meetingId);
  const designAgendaURI = await meetingGeneral.getDesignAgenda(meetingURI);
  const [lastApprovedAgendaId, lastApprovedAgendaURI] = await meetingGeneral.getLastApprovedAgenda(meetingURI);
  await agendaGeneral.setAgendaStatusClosed(lastApprovedAgendaURI);
  await meetingGeneral.closeMeeting(meetingURI, lastApprovedAgendaURI);
  if (designAgendaURI) {
    await agendaDeletion.deleteAgendaAndAgendaitems(designAgendaURI);
  }
  // setTimeout(() => {
    res.send({status: ok, statusCode: 200, body: { lastApprovedAgenda: { id: lastApprovedAgendaId }}});
  // }, 1500);
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
    await agendaDeletion.deleteAgendaAndAgendaitems(designAgendaURI);
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
  // res.send({status: ok, statusCode: 200, body: { reopenedAgenda: { id: lastApprovedAgendaId }}});

  // setTimeout(() => {
    res.send({status: ok, statusCode: 200, body: { reopenedAgenda: { id: lastApprovedAgendaId }}});
  // }, 15000);
});

// TODO KAS-2452 api for create new designagenda ?

/**
 * deleteAgenda
 * 
 * @param agendaId: id of the agenda to delete
 * @param meetingId: id of the meeting
 *
 * delete the agenda
 * if this agenda was the last agenda on the meeting:
 * - delete the newsletter on the meeting
 * - delete the meeting
 */
app.post('/deleteAgenda', async (req, res) => {
  const meetingId = req.body.meetingId;
  const agendaId = req.body.agendaId;
  if(!agendaId || !meetingId){
    res.send({status: "fail", statusCode: 400, error: "agenda or meeting id is missing, deletion of agenda failed"});
    return;
  }
  try {
    const meetingURI = await meetingGeneral.getMeetingURI(meetingId);
    // TODO KAS-2452 frontend code to implement PRE delete
    /*
    - On the linked meeting, link the besluitvorming:behandelt to the previous agenda (what if it doesn't exist ?)
    */
    const agendaURI = await agendaGeneral.getAgendaURI(agendaId);
    await agendaDeletion.deleteAgendaAndAgendaitems(agendaURI);
    const [lastApprovedAgendaId, lastApprovedAgendaURI] = await meetingGeneral.getLastApprovedAgenda(meetingURI);
    console.log('********lastApprovedAgendaId', lastApprovedAgendaId);
    console.log('********lastApprovedAgendaURI', lastApprovedAgendaURI);
    if (!lastApprovedAgendaURI) {
      console.log('********DELETING MEETING');
      await meetingDeletion.deleteMeetingAndNewsletter(meetingURI);
    }
    setTimeout(() => {
      res.send({status: ok, statusCode: 200});
    }, 3000);
  } catch (e) {
    res.send({status: "fail", statusCode: 500, error: "something went wrong while deleting the agenda", e});
  }
});
