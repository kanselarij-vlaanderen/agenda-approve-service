const sleepTimeout = process.env.SLEEP_TIMEOUT || 5000;
const waitOnBusyTimeoutMs = process.env.WAIT_ON_BUSY_TIMEOUT || 20000;

const parseSparqlResults = (data) => {
  const vars = data.head.vars;
  return data.results.bindings.map(binding => {
    let obj = {};
    vars.forEach(varKey => {
      if (binding[varKey]) {
        obj[varKey] = binding[varKey].value;
      }
    });
    return obj;
  });
};

function sleep() {
  return new Promise((resolve) => {
    setTimeout(resolve, sleepTimeout);
  });
}

/**
 * Util to reserve the service to avoid concurrency
 *
 * Checks if the service is busy, then routinely checks for
 * WAIT_ON_BUSY_TIMEOUT milliseconds to see if the service has become
 * available.
 *
 * NOTE: Can be improved by making serviceBusy a promise but care must
 * be taken this happens in a single thread with checkServiceBusy.
 */
let serviceBusy = false;
async function checkServiceBusy() {
  let maxDate = null; // we set this later so the case of too little time to wait is handled
  while( serviceBusy && ( !maxDate || maxDate >= new Date() ) ) {
    maxDate ||= new Date( Date.now() + waitOnBusyTimeoutMs );
    // wait 50ms to join next runloop for trying again
    await new Promise( (res) => setTimeout( res, 100 ) );
  }

  if (serviceBusy) {
    let error = new Error('Agenda service is busy. Please refresh and try again later');
    error.status = 500;
    throw error;
  } else {
    return false;
  }
}
function setServiceBusy(value) {
  serviceBusy = value;
}

export {
  parseSparqlResults,
  sleep,
  checkServiceBusy,
  setServiceBusy
};
