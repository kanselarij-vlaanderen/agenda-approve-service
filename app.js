import { app, errorHandler } from 'mu';

import * as agendaGeneral from './repository/agenda-general';
import * as meetingGeneral from './repository/meeting-general';
import * as agendaApproval from './repository/approve-agenda';
import * as agendaDeletion from './repository/delete-agenda';
import * as meetingDeletion from './repository/delete-meeting';

const cacheClearTimeout = process.env.CACHE_CLEAR_TIMEOUT || 2000;

/*
  * NOTE *
  These actions should only be executable in certain conditions
  The rules are only partially in this service
  Frontend has all the rules (profile differences)
*/

/**
 * approveAgenda
 *
 * @param agenda id: id of the design agenda to approve
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
app.post('/agendas/:id/approve', async (req, res, next) => {
  const agendaId = req.params.id;
  try {
    if (!agendaId) {
      const error = new Error('Mandatory parameter agenda-id not found.');
      error.status = 400;
      return next(error);
    }

    const designAgendaURI = await meetingGeneral.getDesignAgenda(agendaId);
    if (!designAgendaURI) {
      const error = new Error(`Agenda with id ${agendaId} is not a design agenda.`);
      error.status = 404;
      return next(error);
    }

    await agendaGeneral.setAgendaStatusApproved(designAgendaURI);
    // rename the recently approved design agenda for clarity
    const approvedAgendaURI = designAgendaURI;
    const [newAgendaId, newAgendaURI] = await agendaApproval.createNewAgenda(approvedAgendaURI);
    await agendaApproval.copyAgendaitems(approvedAgendaURI, newAgendaURI);
    // enforcing rules on approved agenda
    await agendaApproval.removeNewAgendaitems(approvedAgendaURI);
    await agendaApproval.rollbackAgendaitems(approvedAgendaURI);
    await agendaApproval.sortAgendaitemsOnAgenda(approvedAgendaURI, null);
    // enforcing rules on new agenda
    await agendaApproval.sortNewAgenda(newAgendaURI);
    // We need a small timeout in order for the cache to be cleared by deltas (old agenda status)
    setTimeout(() => {
      res.status(200).send({ data: { type: 'agendas', id: newAgendaId } });
    }, cacheClearTimeout);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: { detail: (err.message || 'Something went wrong during the agenda approval.')}});
  }
});

/**
 * approveAgendaAndCloseMeeting
 *
 * @param agenda id: id of the agenda to close
 *
 * get the design agenda to close (a final approve)
 * actions on design agenda:
 * - set the closed status, modified date
 * actions on meeting:
 * - set ext:finaleZittingVersie to true
 * - set the besluitvorming:behandelt to the closed agenda
 * actions on closed agenda:
 * - enforce formally ok rules:
 *    - new agendaitems that were not formally OK have to be removed (cleanup similar to delete agenda)
 *    - recurring agendaitems that were not formally OK have to be rolled back
 *    - agendaitems have to be sorted to fix gaps in numbering (only if there were new agendaitems that have been deleted)
 */
app.post('/agendas/:id/close', async (req, res, next) => {
  const agendaId = req.params.id;
  try {
    if (!agendaId) {
      const error = new Error('Mandatory parameter agenda-id not found.');
      error.status = 400;
      return next(error);
    }

    const designAgendaURI = await meetingGeneral.getDesignAgenda(agendaId);
    if (!designAgendaURI) {
      const error = new Error(`Agenda with id ${agendaId} is not a design agenda.`);
      error.status = 404;
      return next(error);
    }

    await agendaGeneral.setAgendaStatusClosed(designAgendaURI);
    // rename the recently closed design agenda for clarity
    const closedAgendaURI = designAgendaURI;
    await meetingGeneral.closeMeeting(closedAgendaURI);
    // enforcing rules on closed agenda
    const newAgendaitems = await agendaGeneral.selectNewAgendaitemsNotFormallyOk(closedAgendaURI);
    await agendaDeletion.cleanupAndDeleteNewAgendaitems(newAgendaitems);
    await agendaApproval.rollbackAgendaitems(closedAgendaURI);
    await agendaApproval.sortAgendaitemsOnAgenda(closedAgendaURI, null);

    // We need a small timeout in order for the cache to be cleared by deltas (old agenda & meeting attributes)
    setTimeout(() => {
      res.status(204).send();
    }, cacheClearTimeout);
  } catch (err) {
    console.error(err);
    res.status(500).send({error: { detail: (err.message || 'Something went wrong during the agenda approval and closing of the meeting.')}});
  }
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
app.post('/meetings/:id/close', async (req, res, next) => {
  const meetingId = req.params.id;
  try {
    if (!meetingId) {
      const error = new Error('Mandatory parameter meeting-id not found.');
      error.status = 400;
      return next(error);
    }
    const meetingURI = await meetingGeneral.getMeetingURI(meetingId);
    const designAgendaURI = await meetingGeneral.getDesignAgendaFromMeetingURI(meetingURI);
    const lastApprovedAgenda = await meetingGeneral.getLastApprovedAgenda(meetingURI);
    if (!lastApprovedAgenda) {
      throw new Error(`There should be at least 1 approved Agenda on meeting with id ${meetingId}`);
    }
    await agendaGeneral.setAgendaStatusClosed(lastApprovedAgenda.uri);
    await meetingGeneral.closeMeeting(lastApprovedAgenda.uri);
    await meetingGeneral.updateLastApprovedAgenda(meetingURI, lastApprovedAgenda.uri); // TODO workaround for cache (deleting agenda with only an approval item)
    if (designAgendaURI) {
      await agendaDeletion.deleteAgendaAndAgendaitems(designAgendaURI);
    }

    // We need a small timeout in order for the cache to be cleared by deltas (old agenda & meeting attributes)
    setTimeout(() => {
      res.status(200).send( { data: { "type": "agendas", "id": lastApprovedAgenda.id } });
    }, cacheClearTimeout);
  } catch (err) {
    console.error(err);
    res.status(500).send({error: { detail: (err.message || 'Something went wrong during the closing of the meeting.')}});
  }
});

/**
 * reopenPreviousAgenda
 *
 * @param agendaId: id of the meeting
 *
 * get the last approved agenda & design agenda (if any)
 * actions on last approved agenda:
 * - set the design status, modified date
 * remove the design agenda (if any)
 *
 * @returns the id of the last approved agenda that has been reopened
 */
 app.post('/agendas/:id/reopen', async (req, res, next) => {
  const agendaId = req.params.id;
  try {
    if (!agendaId) {
      const error = new Error('Mandatory parameter agenda-id not found.');
      error.status = 400;
      return next(error);
    }

    const designAgendaURI = await meetingGeneral.getDesignAgenda(agendaId);
    const meetingURI = await meetingGeneral.getMeetingURIFromAgenda(designAgendaURI);
    const lastApprovedAgenda = await meetingGeneral.getLastApprovedAgenda(meetingURI);
    if (!lastApprovedAgenda) {
      const error = new Error(`There should be at least 1 approved Agenda on meeting with URI ${meetingURI}`);
      error.status = 404;
      return next(error);
    }
    await agendaGeneral.setAgendaStatusDesign(lastApprovedAgenda.uri);

    // current frontend checks only allow this action if design agenda is present
    // but there is no reason for this, we should be able to reopen an approved agenda without a designAgenda (same flow, less steps)
    if (designAgendaURI) {
      await agendaDeletion.deleteAgendaAndAgendaitems(designAgendaURI);
    }
    // timeout doesn't seem needed in this case (because currently, there is always a previous agenda, the change in route is enough delay)
    res.status(200).send({ data: { "type": "agendas", "id": lastApprovedAgenda.id } } );
  } catch (err) {
    console.error(err);
    res.status(500).send({error: { detail: (err.message || 'Something went wrong during the reopening of the agenda.')}});
  }
});

/**
 * deleteAgenda
 *
 * * NOTE: we only allow the deletion of the latest agenda, to prevent breaking versioning between agendas and agendaitems
 *
 * @param agendaId: id of the agenda
 *
 * get the latest agenda
 * delete the agenda
 * if this agenda was the last agenda on the meeting:
 * - delete the newsletter on the meeting
 * - delete the meeting
 */
app.delete('/agendas/:id', async (req, res, next) => {
  const agendaId = req.params.id;
  try {
    if (!agendaId) {
      const error = new Error('Mandatory parameter agenda-id not found.');
      error.status = 400;
      return next(error);
    }

    const agendaURIToCheck = await agendaGeneral.getAgendaURI(agendaId);
    const meetingURI = await meetingGeneral.getMeetingURIFromAgenda(agendaURIToCheck);
    const agendaURI = await meetingGeneral.getLastestAgenda(meetingURI);
    if (agendaURI !== agendaURIToCheck) {
      const error =  new Error(`Agenda with id ${agendaId} is not the last agenda.`);
      error.status = 404;
      return next(error);
    }
    await agendaDeletion.deleteAgendaAndAgendaitems(agendaURI);
    // We get the last approved agenda after deletion, because it is possible to delete approved agendas
    const lastApprovedAgenda = await meetingGeneral.getLastApprovedAgenda(meetingURI);
    let responseData = null;
    if (!lastApprovedAgenda) {
      await meetingDeletion.deleteMeetingAndNewsletter(meetingURI);

    } else {
      await meetingGeneral.updateLastApprovedAgenda(meetingURI, lastApprovedAgenda.uri); // TODO workaround for cache (deleting agenda with only an approval item)
      responseData = { "type": "agendas", "id": lastApprovedAgenda.id };
    }
    // We need a small timeout in order for the cache to be cleared by deltas (old agenda & meeting.agendas from cache)
    setTimeout(() => {
      res.status(200).send({ data: responseData });
    }, cacheClearTimeout);
  } catch (err) {
    console.log(`Delete agenda ${agendaId} failed.`);
     // TODO APA can this be done in a better way?
    console.error(err);
    next(err);
  }
});

  /**
 * createDesignAgenda
 *
 * * NOTE this API endpoint is also used to reopen the meeting
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
app.post('/meetings/:id/reopen', async (req, res, next) => {
  const meetingId = req.params.id;
  try {
    if (!meetingId) {
      const error = new Error('Mandatory parameter meeting-id not found.');
      error.status = 400;
      return next(error);
    }

    const meetingURI = await meetingGeneral.getMeetingURI(meetingId);
    const designAgendaURI = await meetingGeneral.getDesignAgendaFromMeetingURI(meetingURI);
    if (designAgendaURI) {
      const error = new Error(`Meeting with id ${meetingId} already has a design agenda, only 1 is allowed.`);
      error.status = 404;
      return next(error);
    }
    // Reopen meeting is not needed when adding a design agenda after manual deletion of current one
    // But the triples inserted/deleted don't have any negative effects
    await meetingGeneral.reopenMeeting(meetingURI);
    const lastApprovedAgenda = await meetingGeneral.getLastApprovedAgenda(meetingURI);
    await agendaGeneral.setAgendaStatusApproved(lastApprovedAgenda.uri);
    const [newAgendaId, newAgendaURI] = await agendaApproval.createNewAgenda(lastApprovedAgenda.uri);
    await agendaApproval.copyAgendaitems(lastApprovedAgenda.uri, newAgendaURI);

    // We need a small timeout in order for the cache to be cleared by deltas (old agenda status)
    setTimeout(() => {
      res.status(200).send({ data: { "type": "agendas", "id": newAgendaId } } );
    }, cacheClearTimeout);
  } catch (err) {
    console.error(err);
    res.status(500).send({error: { detail: (err.message || 'Something went wrong during the creation of the designagenda.')}});
  }
});

app.use(errorHandler);
