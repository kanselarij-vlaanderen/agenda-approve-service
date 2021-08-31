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

// TODO KAS-2452 all frontend validations WHEN an action should be allowed (or risk actions being )

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
 * - new agendaitems (if any) have to be resorted to the bottom of the lists (approval and nota separately)
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
  // timeout doesn't seem needed because of route change in frontend
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

  // We need a small timeout in order for the cache to be cleared by deltas (old agenda & meeting attributes from cache)
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
  const meetingId = req.body.meetingId;
  if(!meetingId){
    res.send({status: "fail", statusCode: 400, error: "meeting id is missing, closing of meeting failed"});
    return;
  }
  const meetingURI = await meetingGeneral.getMeetingURI(meetingId);
  const designAgendaURI = await meetingGeneral.getDesignAgenda(meetingURI);
  const lastApprovedAgenda = await meetingGeneral.getLastApprovedAgenda(meetingURI);
  await agendaGeneral.setAgendaStatusClosed(lastApprovedAgenda.uri);
  await meetingGeneral.closeMeeting(meetingURI, lastApprovedAgenda.uri);
  await meetingGeneral.updateLastApprovedAgenda(meetingURI, lastApprovedAgenda.uri); // TODO KAS-2452 workaround for cache (deleting agenda with only an approval item)
  if (designAgendaURI) {
    await agendaDeletion.deleteAgendaAndAgendaitems(designAgendaURI);
  }
  // timeout doesn't seem needed here
  // setTimeout(() => {
    res.send({status: ok, statusCode: 200, body: { lastApprovedAgenda: { id: lastApprovedAgenda.id }}});
  // }, 1500);
});

/**
 * reopenPreviousAgenda
 * 
 * @param meetingId: id of the meeting
 *
 * actions on last approved agenda:
 * - set the design status, modified date
 * remove the design agenda (if any)
 *
 * @returns the id of the last approved agenda that has been reopened
 */
app.post('/reopenPreviousAgenda', async (req, res) => {
  const meetingId = req.body.meetingId;
  const meetingURI = await meetingGeneral.getMeetingURI(meetingId);

  const designAgendaURI = await meetingGeneral.getDesignAgenda(meetingURI);
  const lastApprovedAgenda = await meetingGeneral.getLastApprovedAgenda(meetingURI);
  await agendaGeneral.setAgendaStatusDesign(lastApprovedAgenda.uri);

  // current frontend checks only allow this action if design agenda is present
  // but there is no reason for this, we should be able to reopen an approved agenda without a designAgenda (same flow, less steps)
  if (designAgendaURI) {
    await agendaDeletion.deleteAgendaAndAgendaitems(designAgendaURI);
  }
  // timeout doesn't seem needed in this case (because currently, there is always a previous agenda, the change in route is enough delay)
  res.send({status: ok, statusCode: 200, body: { reopenedAgenda: { id: lastApprovedAgenda.id }}});
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
    // TODO KAS-2452 set the besluitvorming:behandelt on meeting to the last approved agenda ?? Should only be needed if an agenda is deleted from a closed meeting (possible, but shouldn't happen?)
    const agendaURI = await agendaGeneral.getAgendaURI(agendaId);
    await agendaDeletion.deleteAgendaAndAgendaitems(agendaURI);
    // We get the last approved agenda after deletion, because it is possible to delete approved agendas
    const lastApprovedAgenda = await meetingGeneral.getLastApprovedAgenda(meetingURI);
    if (!lastApprovedAgenda) {
      await meetingDeletion.deleteMeetingAndNewsletter(meetingURI);
    } else {
      await meetingGeneral.updateLastApprovedAgenda(meetingURI, lastApprovedAgenda.uri); // TODO KAS-2452 workaround for cache (deleting agenda with only an approval item)
    }
    // We need a small timeout in order for the cache to be cleared by deltas (old agenda & meeting.agendas from cache)
    setTimeout(() => {
      res.send({status: ok, statusCode: 200});
    }, 1500);
  } catch (e) {
    // TODO KAS-2452 do we want a try catch on each of these API calls ?
    res.send({status: "fail", statusCode: 500, error: "something went wrong while deleting the agenda", e});
  }
});
