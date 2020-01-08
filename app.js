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

// Approve agenda
app.post('/approveAgenda', async (req, res) => {
    const newAgendaId = req.body.newAgendaId;
    const oldAgendaId = req.body.oldAgendaId;
    const newAgendaURI = await repository.getAgendaURI(newAgendaId);
    const oldAgendaURI = await repository.getAgendaURI(oldAgendaId);
    const agendaData = await repository.copyAgendaItems(oldAgendaURI, newAgendaURI);

    await repository.markAgendaItemsPartOfAgendaA(oldAgendaURI);
    await repository.storeAgendaItemNumbers(oldAgendaURI);

    try {
        const codeURI = await repository.getSubcasePhaseCode();
        const subcasePhasesOfAgenda = await repository.getSubcasePhasesOfAgenda(newAgendaId, codeURI);

        await util.checkForPhasesAndAssignMissingPhases(subcasePhasesOfAgenda, codeURI);
    } catch (e) {
        console.log("something went wrong while assigning the code 'Geagendeerd' to the agendaitems", e);
    }

    res.send({status: ok, statusCode: 200, body: {agendaData: agendaData}}); // resultsOfSerialNumbers: resultsAfterUpdates
});

// Create new agenda
app.post('/createAgenda', async (req, res) => {
        repository.createNewAgenda(req, res);
    }
);

mu.app.use(mu.errorHandler);
