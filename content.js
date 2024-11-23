let share_token = "";
let access_token = "";
let drive_id = "";
let share_id = "";
let folder_id = "";
let root_folder_id = "";
let reInt = 5;
let timeInterval = 800;

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "transfer") {
    const shareLink = location.href;
    const shareTokenStr = localStorage.getItem("shareToken");
    const tokenStr = localStorage.getItem("token");
    share_token = JSON.parse(shareTokenStr).share_token;
    const accessTokenObj = JSON.parse(tokenStr);
    access_token = accessTokenObj.access_token;
    drive_id = accessTokenObj.default_drive_id;
    const ids = extract_ids_from_link(shareLink);
    share_id = ids[0];
    folder_id = ids[1];

    get_share_info(share_id)
      .then((share_info) => {
        if (folder_id) {
          root_folder_id = folder_id;
        } else {
          root_folder_id = share_info["file_infos"][0]["file_id"];
        }

        target_folder_name = share_info["share_name"];
        return create_folder("root", target_folder_name);
      })
      .then(async (target_folder) => {
        const target_folder_id = target_folder["file_id"];
        sendMessage(`创建转存文件夹成功`);
        await save_shared_folder(root_folder_id, target_folder_id);
        sendMessage("success");
      });
  }
});

function sendMessage(msg) {
  chrome.runtime.sendMessage(
    {
      msg: msg,
    },
    function (response) {}
  );
}

async function check_async_task(task_id) {
  let data = {
    requests: [
      {
        body: {
          async_task_id: task_id,
        },
        headers: { "Content-Type": "application/json" },
        id: task_id,
        method: "POST",
        url: "/async_task/get",
      },
    ],
    resource: "file",
  };

  const result = await make_request_async(
    "/adrive/v4/batch",
    "POST",
    false,
    data
  );

  return result;
}

async function do_check(task_id) {
  while (true) {
    const task_result = await check_async_task(task_id);

    if (task_result.responses) {
      const task_status = task_result.responses[0].body;
      if (task_status.state === "Succeed") {
        sendMessage(
          `成功转存整个目录，共处理 ${task_status.total_process} 个文件`
        );
        return true;
      } else if (
        task_status.state === "Failed" ||
        task_status.state === "Cancelled"
      ) {
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, timeInterval)); // 等待1秒后再次检查
  }
}

async function save_shared_folder(source_folder_id, target_folder_id) {
  return batch_copy_folder(source_folder_id, target_folder_id)
    .then(async (result) => {
      if (result.responses && result["responses"][0]["status"] == 202) {
        const task_id = result["responses"][0]["body"]["async_task_id"];
        // do_check(task_id);
      }

      if (result.code == "MaxSaveFileCountExceed") {
        sendMessage("开始执行逐个转存");
        return list_files(source_folder_id, 20);
      }
    })
    .then(async (res) => {
      if (res === true || res === undefined) {
        return true;
      }

      let file_list = [];
      let folder_list = [];

      for (var i in res) {
        if (res[i]["type"] == "folder") {
          folder_list.push(res[i]);
        } else {
          file_list.push(res[i]);
        }
      }

      if (file_list && file_list.length > 0) {
        try {
          // 每500个文件一批进行处理
          const batch_size = 500;
          for (let i = 0; i < file_list.length; i += batch_size) {
            const batch = file_list.slice(i, i + batch_size);
            const result = await batch_copy_files(batch, target_folder_id);
            if (result.status === 201) {
              sendMessage(`复制文件成功`);
            } else {
              sendMessage(`复制文件失败`);
            }
            await new Promise((resolve) => setTimeout(resolve, timeInterval));
          }
        } catch (e) {
          sendMessage(`批量复制文件时出错: ${e}`);
        }
      }

      for (const folder of folder_list) {
        try {
          await save_shared_folder(folder["file_id"], target_folder_id);
        } catch (e) {
          sendMessage(`处理文件夹 ${folder["name"]} 时出错: ${e}`);
        }
        await new Promise((resolve) => setTimeout(resolve, timeInterval));
      }

      return true;
    });
}

async function batch_copy_files(file_list, to_parent_file_id) {
  let requests_data = [];

  for (var i in file_list) {
    const file_id =
      typeof file_list[i] === "string" ? file_list[i] : file_list[i]["file_id"];

    requests_data.push({
      body: {
        file_id: file_id,
        share_id: share_id,
        auto_rename: true,
        to_parent_file_id: to_parent_file_id,
        to_drive_id: drive_id,
      },
      headers: { "Content-Type": "application/json" },
      id: i.toString(),
      method: "POST",
      url: "/file/copy",
    });

    let data = {
      requests: requests_data,
      resource: "file",
    };

    let result = await make_request_async(
      "/adrive/v4/batch",
      "POST",
      true,
      data
    );

    return result.responses[0];
  }
}

async function list_files(parent_file_id, limit) {
  let all_files = [];
  let next_marker = null;
  const data = {
    share_id: share_id,
    parent_file_id: parent_file_id,
    limit: limit,
    order_by: "name",
    order_direction: "DESC",
    image_thumbnail_process: "image/resize,w_256/format,jpeg",
    image_url_process: "image/resize,w_1920/format,jpeg/interlace,1",
    video_thumbnail_process: "video/snapshot,t_1000,f_jpg,ar_auto,w_256",
  };

  while (true) {
    if (next_marker) {
      data["marker"] = next_marker;
    }

    const result = await make_request_async(
      "/adrive/v2/file/list_by_share",
      "post",
      true,
      data
    );

    next_marker = result.next_marker;
    all_files = all_files.concat(result.items);
    sendMessage(`获取文件列表成功`);
    await new Promise((resolve) => setTimeout(resolve, timeInterval));
    if (!next_marker) {
      break;
    }
  }

  return all_files;
}

function batch_copy_folder(root_folder_id, to_parent_file_id) {
  requests_data = [
    {
      body: {
        file_id: root_folder_id,
        share_id: share_id,
        auto_rename: true,
        to_parent_file_id: to_parent_file_id,
        to_drive_id: drive_id,
      },
      headers: { "Content-Type": "application/json" },
      id: "0",
      method: "POST",
      url: "/file/copy",
    },
  ];

  data = {
    requests: requests_data,
    resource: "file",
  };

  return make_request("/adrive/v4/batch", "post", true, data);
}

function extract_ids_from_link(url) {
  const arr = url.split("/");
  const share_id_temp = arr[4];
  const folder_id_temp = arr.length > 5 ? arr[arr.length - 1] : null;
  return [share_id_temp, folder_id_temp];
}

function get_headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${access_token}`,
    "X-Canary": "client=web,app=adrive,version=v6.4.2",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "X-Share-Token": share_token,
  };
}

function get_headers_without_x_token() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${access_token}`,
    "X-Canary": "client=web,app=adrive,version=v6.4.2",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  };
}

function get_share_info(share_id) {
  return make_request(
    "/adrive/v3/share_link/get_share_by_anonymous",
    "post",
    true,
    { share_id: share_id }
  );
}

function make_request(url, request_type, head_flag, data) {
  return fetch(`https://api.aliyundrive.com${url}`, {
    method: request_type,
    headers: head_flag ? get_headers() : get_headers_without_x_token(),
    body: JSON.stringify(data),
  }).then((response) => response.json());
}

async function make_request_async(url, request_type, head_flag, data) {
  try {
    const response = await fetch(`https://api.aliyundrive.com${url}`, {
      method: request_type,
      headers: head_flag ? get_headers() : get_headers_without_x_token(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    throw error;
  }
}

function create_folder(parent_file_id, folder_name) {
  return make_request("/adrive/v2/file/createWithFolders", "post", false, {
    drive_id: drive_id,
    parent_file_id: parent_file_id,
    name: folder_name,
    check_name_mode: "refuse",
    type: "folder",
  });
}
