import { app, errorHandler } from 'mu';
import { ok } from 'assert';
import bodyParser from 'body-parser';

import * as agendaGeneral from './repository/agenda-general';
import * as meetingGeneral from './repository/meeting-general';
import * as agendaApproval from './repository/approve-agenda';
import * as agendaDeletion from './repository/delete-agenda';
import * as meetingDeletion from './repository/delete-meeting';

const responseTimeout = process.env.RES_TIMEOUT || 1500;

app.use(bodyParser.json({ type: 'application/*+json' }));
app.use(errorHandler);

// *** NOTE *** these actions should only be executable in certain conditions (the rules for it are only in the frontend)

/**
 * approveAgenda
 * 
 * @param meetingId: id of the meeting that has a design agenda to approve
 * 
 * get the design agenda from the meeting
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
  const meetingId = req.body.meetingId;
  if (!meetingId) {
    res.send({ status: "fail", statusCode: 400, error: "Meeting id is missing, approval of agenda failed" });
    return;
  }
  const meetingURI = await meetingGeneral.getMeetingURI(meetingId);
  const designAgendaURI = await meetingGeneral.getDesignAgenda(meetingURI);
  await agendaGeneral.setAgendaStatusApproved(designAgendaURI);
  // rename the recently approved design agenda for clarity
  const approvedAgendaURI = designAgendaURI;
  const [newAgendaId, newAgendaURI] = await agendaApproval.createNewAgenda(meetingId, approvedAgendaURI);
  await agendaApproval.copyAgendaItems(approvedAgendaURI, newAgendaURI);
  // await agendaApproval.storeAgendaItemNumbers(oldAgendaURI); // TODO: document what this is for. Otherwise remove.
  await agendaApproval.enforceFormalOkRules(approvedAgendaURI);
  await agendaApproval.sortNewAgenda(newAgendaURI);
  // We need a small timeout in order for the cache to be cleared by deltas (old agenda status)
  setTimeout(() => {
    res.send({ status: ok, statusCode: 200, body: { newAgenda: { id: newAgendaId } } });
  }, responseTimeout);
});

/**
 * approveAgendaAndCloseMeeting
 * 
 * @param meetingId: id of the meeting to close
 * 
 * get the design agenda to close (a final approve)
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
  if (!meetingId) {
    res.send({ status: "fail", statusCode: 400, error: "Meeting id is missing, approval and closing of agenda failed" });
    return;
  }
  const meetingURI = await meetingGeneral.getMeetingURI(meetingId);
  const designAgendaURI = await meetingGeneral.getDesignAgenda(meetingURI);
  await agendaGeneral.setAgendaStatusClosed(designAgendaURI);
  // rename the recently closed design agenda for clarity
  const closedAgendaURI = designAgendaURI;
  await meetingGeneral.closeMeeting(meetingURI, closedAgendaURI);
  await agendaApproval.enforceFormalOkRules(closedAgendaURI);

  // We need a small timeout in order for the cache to be cleared by deltas (old agenda & meeting attributes)
  setTimeout(() => {
    res.send({ status: ok, statusCode: 200 });
  }, responseTimeout);
});

/**
 * closeMeeting
 * 
 * @param meetingId: id of the meeting to close
 * 
 * get the last approved agenda & design agenda (if any)
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
  if (!meetingId) {
    res.send({ status: "fail", statusCode: 400, error: "meeting id is missing, closing of meeting failed" });
    return;
  }
  const meetingURI = await meetingGeneral.getMeetingURI(meetingId);
  const designAgendaURI = await meetingGeneral.getDesignAgenda(meetingURI);
  const lastApprovedAgenda = await meetingGeneral.getLastApprovedAgenda(meetingURI);
  await agendaGeneral.setAgendaStatusClosed(lastApprovedAgenda.uri);
  await meetingGeneral.closeMeeting(meetingURI, lastApprovedAgenda.uri);
  await meetingGeneral.updateLastApprovedAgenda(meetingURI, lastApprovedAgenda.uri); // TODO workaround for cache (deleting agenda with only an approval item)
  if (designAgendaURI) {
    await agendaDeletion.deleteAgendaAndAgendaitems(designAgendaURI);
  }

  // We need a small timeout in order for the cache to be cleared by deltas (old agenda & meeting attributes)
  setTimeout(() => {
    res.send({ status: ok, statusCode: 200, body: { lastApprovedAgenda: { id: lastApprovedAgenda.id } } });
  }, responseTimeout);
});

/**
 * reopenPreviousAgenda
 * 
 * @param meetingId: id of the meeting
 *
 * get the last approved agenda & design agenda (if any)
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
  res.send({ status: ok, statusCode: 200, body: { reopenedAgenda: { id: lastApprovedAgenda.id } } });
});

/**
 * deleteAgenda
 * 
 * * NOTE: we only allow the deletion of the latest agenda, to prevent breaking versioning between agendas and agendaitems
 * 
 * @param meetingId: id of the meeting
 *
 * get the latest agenda
 * delete the agenda
 * if this agenda was the last agenda on the meeting:
 * - delete the newsletter on the meeting
 * - delete the meeting
 */
app.post('/deleteAgenda', async (req, res) => {
  const meetingId = req.body.meetingId;
  if (!meetingId) {
    res.send({ status: "fail", statusCode: 400, error: "Meeting id is missing, deletion of agenda failed" });
    return;
  }
  try {
    const meetingURI = await meetingGeneral.getMeetingURI(meetingId);
    const agendaURI = await meetingGeneral.getLastestAgenda(meetingURI);
    await agendaDeletion.deleteAgendaAndAgendaitems(agendaURI);
    // We get the last approved agenda after deletion, because it is possible to delete approved agendas
    const lastApprovedAgenda = await meetingGeneral.getLastApprovedAgenda(meetingURI);
    if (!lastApprovedAgenda) {
      await meetingDeletion.deleteMeetingAndNewsletter(meetingURI);
    } else {
      await meetingGeneral.updateLastApprovedAgenda(meetingURI, lastApprovedAgenda.uri); // TODO workaround for cache (deleting agenda with only an approval item)
    }
    // We need a small timeout in order for the cache to be cleared by deltas (old agenda & meeting.agendas from cache)
    setTimeout(() => {
      res.send({ status: ok, statusCode: 200 });
    }, responseTimeout);
  } catch (e) {
    // TODO KAS-2452 do we want a try catch on each of these API calls ?
    res.send({ status: "fail", statusCode: 500, error: "something went wrong while deleting the agenda", e });
  }
});

  /**
 * createDesignAgenda
 * 
 * @param meetingId: id of the meeting
 * 
 * actions on meeting:
 * - set ext:finaleZittingVersie to false
 * - delete the besluitvorming:behandelt relation
 * actions on latest approved agenda:
 * - set the approved status, modified date
 * creating design agenda:
 * - create new agenda
 * - copy the agendaitems (insert new agendaitems, copy left and right triples)
 * @returns the id of the created agenda
 */
app.post('/createDesignAgenda', async (req, res) => {
  const meetingId = req.body.meetingId;
  if (!meetingId) {
    res.send({ status: "fail", statusCode: 400, error: "Meeting id is missing, creation of design agenda failed" });
    return;
  }
  const meetingURI = await meetingGeneral.getMeetingURI(meetingId);
  await meetingGeneral.reopenMeeting(meetingURI);
  const lastApprovedAgenda = await meetingGeneral.getLastApprovedAgenda(meetingURI);
  await agendaGeneral.setAgendaStatusApproved(lastApprovedAgenda.uri);
  const [newAgendaId, newAgendaURI] = await agendaApproval.createNewAgenda(meetingId, lastApprovedAgenda.uri);
  await agendaApproval.copyAgendaItems(lastApprovedAgenda.uri, newAgendaURI);

  // We need a small timeout in order for the cache to be cleared by deltas (old agenda status)
  setTimeout(() => {
    res.send({ status: ok, statusCode: 200, body: { newAgenda: { id: newAgendaId } } });
  }, responseTimeout);
});
