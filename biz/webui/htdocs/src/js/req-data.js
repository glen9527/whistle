require('./base-css.js');
require('../css/req-data.css');
var React = require('react');
var ReactDOM = require('react-dom');
var $ = require('jquery');
var QRCode = require('qrcode');
var util = require('./util');
var columns = require('./columns');
var Dialog = require('./dialog');

var FilterInput = require('./filter-input');
var Spinner = require('./spinner');
var ContextMenu = require('./context-menu');
var events = require('./events');
var dataCenter = require('./data-center');
var HEIGHT = 24; //每条数据的高度
var columnState = {};
var NOT_BOLD_RULES = {
  plugin: 1,
  pac: 1,
  reqWrite: 1,
  resWrite: 1,
  reqWriteRaw: 1,
  resWriteRaw: 1,
  exports: 1,
  exportsUrl: 1,
  responseFor: 1
};
var contextMenuList = [
  {
    name: 'Open',
    list: [
      { name: 'New Tab'},
      { name: 'QR Code' }
    ]
  },
  {
    name: 'Copy',
    list: [
      { name: 'Host' },
      { name: 'Path' },
      { name: 'URL' },
      { name: 'Full URL' },
      { name: 'As CURL' },
      { name: 'Client IP' },
      { name: 'Server IP' }
    ]
  },
  {
    name: 'Show',
    list:  [
      { name: 'Overview' },
      { name: 'Request' },
      { name: 'Response' },
      { name: 'Timeline' }
    ]
  },
  {
    name: 'Remove',
    list:  [
      { name: 'It' },
      { name: 'All' },
      { name: 'Others' },
      { name: 'Selected' },
      { name: 'Unselected' }
    ]
  },
  { name: 'Composer' },
  { name: 'Replay' },
  { name: 'Upload' },
  { name: 'Export' },
  { name: 'Import' },
  { name: 'Help', sep: true }
];

function getUploadSessionsFn() {
  try {
    var uploadSessions = window.parent.uploadWhistleSessions;
    return typeof uploadSessions === 'function' ? uploadSessions : null;
  } catch(e) {}
}

function getClassName(data) {
  return getStatusClass(data) + ' w-req-data-item'
    + (data.isHttps ? ' w-tunnel' : '')
      + (hasRules(data) ? ' w-has-rules' : '')
        + (data.selected ? ' w-selected' : '');
}

function hasRules(data) {
  var rules = data.rules;
  if (!rules) {
    return false;
  }
  var keys = Object.keys(data.rules);
  if (keys && keys.length) {
    for (var i = 0, len = keys.length; i < len; i++) {
      if (rules[keys[i]] && !NOT_BOLD_RULES[keys[i]]) {
        return true;
      }
    }
  }

  return false;
}

function getStatusClass(data) {
  var type = '';
  var headers = data.res.headers;
  switch(util.getContentType(headers)) {
  case 'JS':
    type = 'warning';
    break;
  case 'CSS':
    type = 'info';
    break;
  case 'HTML':
    type = 'success';
    break;
  case 'IMG':
    type = 'active';
    break;
  }

  var statusCode = data.res && data.res.statusCode;
  if (data.reqError || data.resError) {
    type += ' danger w-error-status';
  } else if (statusCode == 403) {
    type += ' w-forbidden';
  } else if (statusCode && (!/^\d+$/.test(statusCode) || statusCode >= 400)) {
    type += ' w-error-status';
  }

  return type;
}

function getSelectedRows() {
  var range = getSelection();
  if (!range) {
    return;
  }
  try {
    range = range.getRangeAt(0);
  } catch(e) {
    return;
  }
  var startElem = $(range.startContainer).closest('.w-req-data-item');
  if (!startElem.length) {
    return null;
  }
  var endElem = $(range.endContainer).closest('.w-req-data-item');
  if (!startElem.length || !endElem.length) {
    return null;
  }
  return [startElem, endElem];
}

function getSelection() {
  if (window.getSelection) {
    return window.getSelection();
  }
  return document.getSelection();
}

var ReqData = React.createClass({
  getInitialState: function() {
    var dragger = columns.getDragger();
    dragger.onDrop = dragger.onDrop.bind(this);
    return {
      draggable: true,
      columns: columns.getSelectedColumns(),
      dragger: dragger
    };
  },
  componentDidMount: function() {
    var self = this;
    var timer;
    events.on('hashFilterChange', function() {
      self.setState({});
    });
    events.on('onColumnsChanged', function() {
      self.setState({
        columns: columns.getSelectedColumns()
      });
    });
    var update = function() {
      self.setState({});
    };
    var render = function() {
      timer && clearTimeout(timer);
      timer = setTimeout(update, 60);
    };
    self.container = ReactDOM.findDOMNode(self.refs.container);
    self.content = ReactDOM.findDOMNode(self.refs.content);
    var toggoleDraggable = function(e) {
      var draggable = !e.shiftKey;
      if (self.state.draggable === draggable) {
        return;
      }
      self.setState({ draggable: draggable });
    };
    $(self.container).on('keydown', function(e) {
      var modal = self.props.modal;
      toggoleDraggable(e);
      if (!modal) {
        return;
      }
      var item;
      if (e.keyCode == 38) { //up
        item = modal.prev();
      } else if (e.keyCode == 40) {//down
        item = modal.next();
      }

      if (item) {
        self.onClick(e, item, true);
        e.preventDefault();
      }
    }).on('scroll', render).on('keyup', toggoleDraggable)
    .on('mouseover', toggoleDraggable)
    .on('mouseleave', toggoleDraggable);

    $(window).on('resize', render);
  },
  onDragStart: function(e) {
    var target = $(e.target).closest('.w-req-data-item');
    e.dataTransfer.setData('reqDataId', target.attr('data-id'));
  },
  onClick: function(e, item, hm) {
    var self = this;
    var modal = self.props.modal;
    var resetRange = function() {
      var range = window.getSelection();
      if (range) {
        range.removeAllRanges();
        var target = e.target;
        var row = $(target).closest('.w-req-data-item')[0];
        if (row) {
          var draggable = row.draggable;
          row.draggable = false;
          var r = document.createRange();
          r.selectNodeContents(target);
          range.addRange(r);
          if (draggable) {
            row.draggable = true;
          }
        }
      }
      return range;
    };
    var rows;
    if (e.shiftKey) {
      rows = getSelectedRows();
      !rows && resetRange();
    } else {
      resetRange();
    }
    var allowMultiSelect = e.ctrlKey || e.metaKey;
    if (hm || !allowMultiSelect) {
      self.clearSelection();
    }
    if (hm) {
      item.selected = true;
    } else {
      rows;
      if (e.shiftKey && (rows = getSelectedRows())) {
        modal.setSelectedList(rows[0].attr('data-id'),
            rows[1].attr('data-id'));
      } else {
        item.selected = !allowMultiSelect || !item.selected;
      }
    }

    modal.clearActive();
    item.active = true;
    if (self.props.onClick && self.props.onClick(item)) {
      self.setState({
        activeItem: item
      });
    }
    hm && util.ensureVisible(ReactDOM.findDOMNode(self.refs[item.id]), self.container);
  },
  clearSelection: function() {
    var modal = this.props.modal;
    modal && modal.clearSelection();
  },
  onClickContextMenu: function(action, e) {
    var self = this;
    var item = self.currentFocusItem;
    switch(action) {
    case 'New Tab':
      item && window.open(item.url);
      break;
    case 'QR Code':
      if (item) {
        var canvas = ReactDOM.findDOMNode(self.refs.qrcodeCanvas);
        canvas.title = item.url;
        QRCode.toCanvas(canvas, item.url, {
          width: 320,
          height: 320,
          margin: 0
        }, function (err) {
          if (err) {
            return alert(err.message);
          }
          ReactDOM.findDOMNode(self.refs.qrcodeUrl).value = item.url;
          self.refs.qrcodeDialog.show();
        });
      }
      break;
    case 'Overview':
      events.trigger('activeItem', item);
      events.trigger('showOverview');
      break;
    case 'Request':
      events.trigger('activeItem', item);
      events.trigger('showRequest');
      break;
    case 'Response':
      events.trigger('activeItem', item);
      events.trigger('showResponse');
      break;
    case 'Timeline':
      events.trigger('activeItem', item);
      events.trigger('showTimeline');
      break;
    case 'Composer':
      events.trigger('composer', item);
      break;
    case 'Replay':
      events.trigger('replaySessions', [item, e.shiftKey]);
      break;
    case 'Export':
      events.trigger('exportSessions', item);
      break;
    case 'Upload':
      events.trigger('uploadSessions', {
        curItem: item,
        upload: getUploadSessionsFn()
      });
      break;
    case 'Import':
      events.trigger('importSessions');
      break;
    case 'It':
      events.trigger('removeIt', item);
      break;
    case 'All':
      events.trigger('clearAll');
      break;
    case 'Others':
      events.trigger('removeOthers', item);
      break;
    case 'Selected':
      events.trigger('removeSelected');
      break;
    case 'Unselected':
      events.trigger('removeUnselected');
      break;
    case 'Help':
      window.open('https://avwo.github.io/whistle/webui/network.html');
      break;
    }
  },
  onContextMenu: function(e) {
    var dataId = $(e.target).closest('.w-req-data-item').attr('data-id');
    var modal = this.props.modal;
    var item = modal.getItem(dataId);
    var disabled = !item;
    e.preventDefault();
    this.currentFocusItem = item;
    contextMenuList[0].disabled = disabled;
    contextMenuList[0].list[0].disabled = disabled || !/^https?:\/\//.test(item.url);
    contextMenuList[1].disabled = disabled;
    contextMenuList[1].list.forEach(function(menu) {
      menu.disabled = disabled;
      switch(menu.name) {
      case 'URL':
        menu.copyText = item && item.url.replace(/[?#].*$/, '');
        break;
      case 'Host':
        menu.copyText = item && (item.isHttps ? item.path : item.hostname);
        break;
      case 'Path':
        menu.copyText = item && item.path;
        break;
      case 'Full URL':
        menu.copyText = item && item.url;
        break;
      case 'As CURL':
        menu.copyText = util.asCURL(item);
        break;
      case 'Client IP':
        menu.copyText = item && item.clientIp;
        break;
      case 'Server IP':
        var serverIp = item && util.getServerIp(item);
        menu.disabled = !serverIp;
        menu.copyText = serverIp;
        break;
      }
    });
    contextMenuList[2].disabled = disabled;
    contextMenuList[2].list.forEach(function(menu) {
      menu.disabled = disabled;
    });
    var selectedList = modal.getSelectedList();
    var selectedCount = selectedList.length;
    var hasData = modal.list.length;
    contextMenuList[3].disabled = !hasData;
    contextMenuList[3].list.forEach(function(menu) {
      menu.disabled = !hasData;
    });
    contextMenuList[3].list[0].disabled = disabled;
    contextMenuList[3].list[2].disabled = hasData <= 1;
    contextMenuList[3].list[3].disabled = !selectedCount;
    contextMenuList[3].list[4].disabled = selectedCount === hasData;
    contextMenuList[4].disabled = disabled;
    if (item) {
      if (item.selected) {
        contextMenuList[5].disabled = !selectedList.filter(util.canReplay).length;
      } else {
        contextMenuList[5].disabled = !util.canReplay(item);
      }
    } else {
      contextMenuList[5].disabled = true;
    }
    var uploadItem = contextMenuList[6];
    uploadItem.hide = !getUploadSessionsFn();
    contextMenuList[7].disabled = uploadItem.disabled = disabled && !selectedCount;
    var data = util.getMenuPosition(e, 110, uploadItem.hide ? 274 : 304);
    data.list = contextMenuList;
    this.refs.contextMenu.show(data);
  },
  onFilterChange: function(keyword) {
    var self = this;
    var modal = self.props.modal;
    var autoRefresh = modal && modal.search(keyword);
    self.setState({filterText: keyword}, function() {
      autoRefresh && self.autoRefresh();
    });
    clearTimeout(self.networkStateChangeTimer);
    self.networkStateChangeTimer = setTimeout(function() {
      events.trigger('networkStateChange');
    }, 600);
  },
  autoRefresh: function() {
    if (this.container) {
      this.container.scrollTop = this.content.offsetHeight;
    }
  },
  getVisibleIndex: function() {
    var container = this.container;
    var len = container && this.props.modal && this.props.modal.list.length;
    var height = len && container.offsetHeight;
    if (height) {
      var scrollTop = container.scrollTop;
      var startIndex = Math.floor(Math.max(scrollTop - 240, 0) / HEIGHT);
      var endIndex = Math.floor(Math.max(scrollTop + height + 240, 0) / HEIGHT);
      this.indeies = [startIndex, endIndex];
    }

    return this.indeies;
  },
  orderBy: function(e) {
    var target = $(e.target).closest('th')[0];
    if (!target) {
      return;
    }
    var modal = this.props.modal;
    var name = target.className;
    var order;
    if (name == 'order') {
      columnState = {};
    } else {
      order = columnState[name];
      if (order == 'desc') {
        columnState[name] = 'asc';
      } else if (order == 'asc') {
        columnState[name] = null;
      } else {
        columnState[name] = 'desc';
      }
    }

    if (modal) {
      var sortColumns = [];
      Object.keys(columnState).forEach(function(name) {
        if (order = columnState[name]) {
          sortColumns.push({
            name: name,
            order: order
          });
        }
      });
      modal.setSortColumns(sortColumns);
    }
    this.setState({});
  },
  onColumnsResort: function() {
    this.setState({ columns: columns.getSelectedColumns() });
  },
  renderColumn: function(col) {
    var name = col.name;
    var disabledColumns = columns.isDisabled();
    return (
      <th {...this.state.dragger} data-name={name}
        draggable={!disabledColumns}
        key={name} className={col.className}
        style={{color: columnState[name] ? '#337ab7' : undefined}}>
        {col.title}<Spinner order={columnState[name]} />
      </th>
    );
  },
  render: function() {
    var self = this;
    var state = this.state;
    var modal = self.props.modal;
    var list = modal ? modal.list : [];
    var hasKeyword = modal && modal.hasKeyword();
    var index = 0;
    var indeies = self.getVisibleIndex();
    var draggable = state.draggable;
    var columnList = state.columns;
    var startIndex, endIndex;

    if (indeies) {
      startIndex = indeies[0];
      endIndex = indeies[1];
    } else {
      startIndex = 0;
      endIndex = list.length;
    }
    var filterText = (state.filterText || '').trim();
    var minWidth = {'min-width': columnList.length * 90 + 120 + 'px'};

    return (
        <div className="fill w-req-data-con orient-vertical-box">
          <div style={minWidth} className="w-req-data-content fill orient-vertical-box">
            <div className="w-req-data-headers">
              <table className="table">
                  <thead>
                    <tr onClick={self.orderBy}>
                      <th className="order">#</th>
                      {columnList.map(this.renderColumn)}
                    </tr>
                  </thead>
                </table>
            </div>
            <div ref="container" tabIndex="0" onContextMenu={self.onContextMenu}
              style={{background: (dataCenter.hashFilterObj || filterText) ? 'lightyellow' : undefined}}
              className="w-req-data-list fill">
              <table ref="content" className="table" onDragStart={this.onDragStart}>
                  <tbody>
                  {
                    list.map(function(item, i) {
                      i = hasKeyword ? index : i;

                      return (<tr tabIndex="-1" draggable={draggable} ref={item.id} data-id={item.id} key={item.id} style={{display: item.hide ? 'none' : ''}}
                              className={getClassName(item)}
                              onClick={function(e) {self.onClick(e, item);}}
                              onDoubleClick={self.props.onDoubleClick}>
                              <th className="order" scope="row">{hasKeyword && !item.hide ? ++index : item.order}</th>
                              {columnList.map(function(col) {
                                var name = col.name;
                                var className = col.className;
                                if (name === 'path') {
                                  var url, path;
                                  if (!item.hide && i >= startIndex && i <= endIndex) {
                                    url = item.url;
                                    path = item.path;
                                  }
                                  return <td key={name} className="path" title={url}>{path}</td>;
                                }
                                var value = name === 'hostIp' ? util.getServerIp(item) : item[name];
                                return (<td key={name} className={className}
                                  title={col.showTitle ? value : undefined}>{value}</td>);
                              })}
                            </tr>);
                    })
                  }
                  </tbody>
                </table>
            </div>
          </div>
          <FilterInput onChange={this.onFilterChange} wStyle={minWidth} />
          <ContextMenu onClick={this.onClickContextMenu} ref="contextMenu" />
          <Dialog ref="qrcodeDialog" wstyle="w-qrcode-dialog">
            <div className="modal-body">
              <button type="button" className="close" data-dismiss="modal">
                <span aria-hidden="true">&times;</span>
              </button>
              <input readOnly ref="qrcodeUrl" />
              <canvas ref="qrcodeCanvas" />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-default" data-dismiss="modal">Close</button>
            </div>
          </Dialog>
      </div>
    );
  }
});

module.exports = ReqData;
